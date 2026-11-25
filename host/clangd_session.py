"""One local clangd and one virtual draft per native port. No generic RPC or filesystem API."""
import io
import json
import os
from pathlib import Path
import re
import subprocess
import threading
from urllib.parse import urlsplit
from urllib.request import url2pathname

from clangd_tools import discover, uses_gnu_headers
from process_tree import Control, Tree
from workspace import reclaim_abandoned, workspace

FEATURES = {'completion', 'signatureHelp', 'hover', 'definition', 'documentSymbol', 'documentHighlight'}
SCHEMAS = {'analysis-open': {'code', 'version', 'standard'}, 'analysis-change': {'code', 'version'},
           'analysis-request': {'id', 'feature', 'position', 'version'}, 'analysis-cancel': {'id'},
           'analysis-close': set()}


def integer(value, minimum=0):
    return type(value) is int and minimum <= value < 2**31


def valid(msg):
    if not isinstance(msg, dict) or not isinstance(msg.get('type'), str):
        return False
    fields = SCHEMAS.get(msg['type'])
    if msg['type'] == 'analysis-request' and msg.get('feature') == 'documentSymbol':
        fields = fields - {'position'}
    if fields is None or msg.keys() != fields | {'type'}:
        return False
    if 'version' in fields and not integer(msg['version'], 1) or 'id' in fields and not integer(msg['id'], 1):
        return False
    if 'code' in fields:
        code = msg['code']
        if not isinstance(code, str) or len(code) > 512 * 1024:
            return False
        try:
            if len(code.encode('utf-8')) > 512 * 1024:
                return False
        except UnicodeEncodeError:
            return False
    if 'standard' in fields and (not isinstance(msg['standard'], str) or not re.fullmatch(r'(gnu|c)\+\+(98|03|11|14|17|20|23|2c)', msg['standard'])):
        return False
    if 'feature' in fields and 'position' not in fields:
        return msg['feature'] == 'documentSymbol'
    if 'feature' in fields:
        pos = msg['position']
        return (isinstance(msg['feature'], str) and msg['feature'] in FEATURES and isinstance(pos, dict)
                and pos.keys() == {'line', 'character'} and all(integer(n) for n in pos.values()))
    return True


def read_packet(stream):
    length = None
    for _ in range(12):
        line = stream.readline(256)
        if line == b'\r\n':
            break
        if not line.endswith(b'\r\n'):
            raise EOFError()
        key, _, value = line.partition(b':')
        if key.lower() == b'content-length':
            length = int(value)
    else:
        raise ValueError('LSP headers')
    if length is None or not 0 < length <= 8 * 1024 * 1024:
        raise ValueError('LSP frame size')
    payload = stream.read(length)  # BufferedReader fills short OS pipe reads.
    if len(payload) != length:
        raise EOFError()
    return json.loads(payload.decode('utf-8'))


def excerpt(value, limit=2048):
    if isinstance(value, dict):
        value = value.get('value')
    return value[:limit] if isinstance(value, str) else ''


def lsp_range(r):
    return (isinstance(r, dict) and all(isinstance(r.get(k), dict) and
            all(integer(r[k].get(c)) for c in ('line', 'character')) for k in ('start', 'end')))


def definition(locations, uri, roots):
    for location in locations if isinstance(locations, list) else [locations]:
        if not isinstance(location, dict):
            continue
        target, span = location.get('uri'), location.get('range')
        if not isinstance(target, str) or not lsp_range(span):
            continue
        if target == uri:
            return {'range': span}
        # Only a server-returned declaration within the discovered toolchain
        # can produce a bounded header excerpt. Never open a caller-supplied path.
        url = urlsplit(target)
        if url.scheme != 'file' or url.netloc or url.path.startswith('//'):
            continue
        try:
            decoded = url2pathname(url.path)
            if decoded.startswith(('\\\\', '//')):
                continue
            lexical = Path(os.path.normpath(decoded))
            if not any(lexical.is_relative_to(p) for p in roots):
                continue
            path = lexical.resolve(strict=True)
            if not any(path.is_relative_to(p) for p in roots) or not path.is_file() or path.stat().st_size > 4_000_000:
                continue
            line = span['start']['line']
            first = max(0, line - 10)
            lines = path.read_text(encoding='utf-8-sig', errors='replace').splitlines()[first:line + 13]
            if lines:
                return {'header': path.name, 'first': first, 'line': line, 'text': '\n'.join(s[:400] for s in lines)}
        except (OSError, ValueError):
            continue


def document_symbols(items, uri):
    """Flatten only this document's symbols, preserving containment and UTF-16 ranges."""
    out = []
    def visit(nodes, parent, depth):
        if not isinstance(nodes, list) or depth > 12:
            return
        for item in nodes[:256]:
            if len(out) == 256:
                return
            if not isinstance(item, dict):
                continue
            loc = item.get('location', {})
            if not isinstance(loc, dict) or loc and loc.get('uri') != uri:
                continue
            span = item.get('range') or loc.get('range')
            sel = item.get('selectionRange') or span
            name = excerpt(item.get('name'), 120)
            kind = item.get('kind')
            if not name or not integer(kind, 1) or kind > 26 or not lsp_range(span) or not lsp_range(sel):
                continue
            index = len(out)
            out.append(dict(name=name, kind=kind, parent=parent, range=span, selectionRange=sel))
            visit(item.get('children'), index, depth + 1)
    visit(items, -1, 0)
    return out


def result_for(feature, result, uri, roots):
    if feature == 'documentSymbol':
        return document_symbols(result, uri)
    if feature == 'documentHighlight':
        if not isinstance(result, list):
            return []
        return [dict(range=item['range'], kind=item.get('kind', 1)) for item in result[:512]
                if isinstance(item, dict) and lsp_range(item.get('range')) and item.get('kind', 1) in (1, 2, 3)]
    if not result:
        return None
    if feature == 'definition':
        return definition(result, uri, roots)
    if feature == 'hover':
        return {'text': excerpt(result.get('contents'), 6000), 'range': result.get('range')}
    if feature == 'signatureHelp':
        signatures = []
        for item in result.get('signatures', [])[:12]:
            label = excerpt(item.get('label'), 1200)
            units = len(label.encode('utf-16-le')) // 2
            params = []
            for p in item.get('parameters', [])[:32]:
                marker = p.get('label')
                if isinstance(marker, list) and len(marker) == 2 and all(integer(n) for n in marker):
                    params.append([min(n, units) for n in marker])
                else:
                    params.append(excerpt(marker, 160))
            signatures.append(dict(label=label, parameters=params))
        return dict(signatures=signatures, activeSignature=result.get('activeSignature', 0),
                    activeParameter=result.get('activeParameter', 0))
    items = result if isinstance(result, list) else result.get('items', [])
    out = []
    for item in items[:80]:
        edit = item.get('textEdit', {})
        label = excerpt(item.get('label'), 200).strip()
        if label:
            out.append(dict(label=label, kind=item.get('kind'), detail=excerpt(item.get('detail'), 300),
                            sort=excerpt(item.get('sortText'), 100), filter=excerpt(item.get('filterText'), 200),
                            insert=excerpt(edit.get('newText', item.get('insertText', label)), 512),
                            range=edit.get('range'), snippet=item.get('insertTextFormat') == 2))
    return {'items': out, 'incomplete': isinstance(result, dict) and bool(result.get('isIncomplete'))}


class Session:
    def __init__(self, msg, send):
        self.standard, self.text, self.version = msg['standard'], msg['code'], msg['version']
        self.prefer_gcc = uses_gnu_headers(self.text)
        self.reconfiguring = False
        self.send = send
        self.lock = threading.RLock()
        self.control = Control()
        self.pending = {}
        self.features = []
        self.tree = None
        self.opened = self.ready = self.closing = False
        self.last_id = 0
        self.finished = threading.Event()
        self.worker = threading.Thread(target=self.run)
        self.worker.start()

    def packet(self, **fields):
        data = json.dumps(dict(jsonrpc='2.0', **fields), ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        wire = memoryview(f'Content-Length: {len(data)}\r\n\r\n'.encode() + data)
        while wire:
            wire = wire[self.tree.proc.stdin.write(wire):]

    def notify(self, method, params):
        self.packet(method=method, params=params)

    def await_ast(self):
        self.parsing_version = self.version
        self.packet(id=-2, method='textDocument/documentSymbol', params={'textDocument': {'uri': self.uri}})

    def run(self):
        unavailable = False
        try:
            reclaim_abandoned()
            with workspace('cboj-lsp') as root:
                config, reason = discover(root, self.standard, self.control, self.prefer_gcc)
                if not config:
                    unavailable = True
                    if not self.closing:
                        self.send(dict(type='analysis-unavailable', reason=reason))
                    return
                args, env, self.family, self.roots = config
                self.uri = (root / 'main.cpp').as_uri()
                with self.lock:
                    if self.closing:
                        return
                    self.tree = Tree(args, root, env)
                proc = self.tree.proc
                def drain():
                    while proc.stderr.read(8192):
                        pass
                stderr = threading.Thread(target=drain)
                stderr.start()
                try:
                    caps = dict(general={'positionEncodings': ['utf-16']}, offsetEncoding=['utf-16'],
                                textDocument=dict(documentSymbol={'hierarchicalDocumentSymbolSupport': True},
                                    publishDiagnostics={'versionSupport': True},
                                    completion={'completionItem': {'snippetSupport': True}},
                                    signatureHelp={'signatureInformation': {'parameterInformation': {'labelOffsetSupport': True}}},
                                    hover={'contentFormat': ['plaintext']}))
                    with self.lock:
                        self.packet(id=0, method='initialize', params=dict(processId=os.getpid(), rootUri=root.as_uri(), capabilities=caps))
                    with io.BufferedReader(proc.stdout) as stream:
                        while self.handle_packet(read_packet(stream)):
                            pass
                finally:
                    self.tree.stop()
                    proc.wait()
                    stderr.join()
                    proc.stdin.close()
                    proc.stderr.close()
        except (OSError, EOFError, UnicodeError, ValueError, KeyError, TypeError, subprocess.SubprocessError):
            pass
        finally:
            with self.lock:
                if not unavailable and not self.closing:
                    self.send(dict(type='analysis-lost'))
                self.ready = False
            self.finished.set()

    def handle_packet(self, msg):
        with self.lock:
            method = msg.get('method')
            if method and 'id' in msg:
                self.packet(id=msg['id'], error={'code': -32601, 'message': 'Unsupported client method'})
            elif self.closing:
                if msg.get('id') == -1:
                    self.notify('exit', {})
                    return False
            elif msg.get('id') == 0:
                caps = (msg.get('result') or {}).get('capabilities', {})
                if not caps.get('completionProvider') or caps.get('positionEncoding', 'utf-16') != 'utf-16':
                    raise ValueError('Incompatible language server')
                self.features = [key for key in ('documentSymbol', 'documentHighlight') if caps.get(key + 'Provider') is not None and caps.get(key + 'Provider') is not False]
                self.notify('initialized', {})
                self.notify('textDocument/didOpen', {'textDocument': dict(uri=self.uri, languageId='cpp', version=self.version, text=self.text)})
                self.opened = True
                # Completion can otherwise run before the very first preamble
                # exists and return an empty lexical fallback for STL members.
                self.await_ast()
            elif msg.get('id') == -2:
                if self.parsing_version != self.version:
                    self.await_ast()
                elif 'error' in msg:
                    raise ValueError('Initial parse failed')
                else:
                    self.ready = True
                    self.send(dict(type='analysis-ready', family=self.family, features=self.features))
            elif method == 'textDocument/publishDiagnostics':
                p = msg['params']
                if p.get('uri') == self.uri and p.get('version') == self.version:
                    items = [dict(range=d['range'], severity=d.get('severity', 1), message=excerpt(d.get('message'), 1200))
                             for d in p.get('diagnostics', [])[:60] if lsp_range(d.get('range'))]
                    self.send(dict(type='analysis-diagnostics', version=self.version, items=items))
            elif 'id' in msg and (entry := self.pending.pop(msg['id'], None)):
                version, feature = entry
                if version == self.version:
                    self.send(dict(type='analysis-result', id=msg['id'], version=version,
                                   result=result_for(feature, msg.get('result'), self.uri, self.roots)))
        return True

    def message(self, msg):
        with self.lock:
            kind = msg['type']
            if kind == 'analysis-change' and msg['version'] > self.version:
                self.text, self.version = msg['code'], msg['version']
                if uses_gnu_headers(self.text) != self.prefer_gcc:
                    if not self.reconfiguring:
                        self.reconfiguring = True
                        self.send(dict(type='analysis-reconfigure'))
                    return
                if self.opened:
                    for request in self.pending:
                        self.notify('$/cancelRequest', {'id': request})
                    self.pending.clear()
                    self.notify('textDocument/didChange', {'textDocument': dict(uri=self.uri, version=self.version),
                                                          'contentChanges': [{'text': self.text}]})
            elif kind == 'analysis-cancel' and self.pending.pop(msg['id'], None):
                self.notify('$/cancelRequest', {'id': msg['id']})
            elif kind == 'analysis-request':
                request = msg['id']
                if not self.ready or self.version != msg['version'] or request <= self.last_id or len(self.pending) >= 32:
                    self.send(dict(type='analysis-result', id=request, version=msg['version'], result=None))
                    return
                self.last_id = request
                self.pending[request] = (self.version, msg['feature'])
                params = {'textDocument': {'uri': self.uri}}
                if 'position' in msg:
                    params['position'] = msg['position']
                self.packet(id=request, method='textDocument/' + msg['feature'], params=params)

    def close(self):
        with self.lock:
            self.closing = True
            self.control.cancel()
            if self.opened:
                try:
                    self.notify('textDocument/didClose', {'textDocument': {'uri': self.uri}})
                    self.packet(id=-1, method='shutdown', params=None)
                except (OSError, ValueError):
                    pass
        if not self.finished.wait(0.8) and self.tree:
            self.tree.stop()
        self.worker.join()


def serve(first, read, send):
    if not valid(first):
        send(dict(type='analysis-unavailable', reason='invalid'))
        return
    session = Session(first, send)
    try:
        while (msg := read()) is not None:
            if not valid(msg) or msg['type'] in ('analysis-close', 'analysis-open'):
                break
            session.message(msg)
    finally:
        session.close()
        send(dict(type='analysis-closed'))
