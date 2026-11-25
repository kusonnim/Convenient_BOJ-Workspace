"""P4.1 fixed operations and native-to-extension size/position boundaries."""
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'host'))
import formatting
from clangd_session import document_symbols, result_for, valid


class EditorProtocol(unittest.TestCase):
    def test_document_operations_have_exact_schemas(self):
        symbols = dict(type='analysis-request', feature='documentSymbol', version=1, id=1)
        point = dict(line=0, character=1)
        self.assertTrue(valid(symbols))
        self.assertFalse(valid(dict(symbols, position=point)))
        self.assertFalse(valid(dict(symbols, uri='other.cpp')))
        highlight = dict(symbols, feature='documentHighlight', position=point)
        self.assertTrue(valid(highlight))
        self.assertFalse(valid(dict(highlight, feature='workspace/symbol')))
        self.assertFalse(valid(dict(highlight, position=dict(line=-1, character=2))))

    def test_symbol_hierarchy_bounds_and_file_filter(self):
        span = dict(start=dict(line=0, character=0), end=dict(line=1, character=1))
        symbol = dict(name='member', range=span, selectionRange=span, kind=6)
        root = dict(symbol, name='Class', kind=5, children=[symbol] * 400)
        tree = document_symbols([root], 'file:///main.cpp')
        self.assertEqual(len(tree), 256)
        self.assertEqual([s['parent'] for s in tree[:3]], [-1, 0, 0])
        foreign = dict(kind=5, name='foreign', location=dict(uri='file:///other.cpp', range=span))
        self.assertEqual(document_symbols([foreign, {}, dict(symbol, location='bad')], 'file:///main.cpp'), [])
        self.assertEqual(result_for('documentHighlight', {}, '', []), [])
        rows = result_for('documentHighlight', [dict(kind=3, range=span)] * 900, '', [])
        self.assertEqual(len(rows), 512)
        self.assertEqual(rows[0]['kind'], 3)

    def test_format_limits_fixed_options_and_unavailable_tool(self):
        msg = dict(type='format', language='cpp', code='int main(){return 0;}', tabs=False)
        for change in [dict(language='python'), dict(tabs=1), dict(path='../main.cpp'), dict(flags=['-i'])]:
            self.assertEqual(formatting.reply(dict(msg, **change))['error'], 'invalid')
        self.assertEqual(formatting.reply(dict(msg, code='한' * 180000))['error'], 'size')
        with patch.object(formatting, 'executable', return_value=None):
            self.assertFalse(formatting.reply(dict(type='format-info'))['available'])
            self.assertEqual(formatting.reply(msg)['error'], 'missing')
        with patch.object(formatting, 'executable', return_value='fixed'), patch.object(formatting, 'execute') as run:
            run.return_value = dict(timeout=True, overLimit=False, code=None)
            self.assertEqual(formatting.reply(msg)['error'], 'failed')
            self.assertEqual(run.call_args.kwargs['timeout'], 6)
            self.assertEqual(run.call_args.kwargs['stdin'], msg['code'].encode())

    def test_real_formatting(self):
        self.assertTrue(formatting.reply(dict(type='format-info'))['available'])
        r = formatting.reply(dict(type='format', language='cpp', tabs=False,
                                  code='int main(){int value=1;return value;}'))
        self.assertIn('int value = 1;', r['code'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
