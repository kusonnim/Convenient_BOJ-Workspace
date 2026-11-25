// Apply small mutations in the worker so two problem tabs cannot lose each other's cases.
const caseStorage = (() => {
  let queue = Promise.resolve();
  const idOK = id => typeof id === 'string' && /^[a-z0-9-]{1,80}$/i.test(id);
  async function change(m, sender) {
    if (!problemSender(sender) || new URL(sender.url).pathname.replace(/\/$/, '') !== '/problem/' + m.pid || !idOK(m.id)) return { ok: false };
    if (!['add','edit','move','remove'].includes(m.op)) return { ok: false };
    const key = 'cases:' + m.pid;
    const current = (await chrome.storage.local.get(key))[key] ?? [];
    if (!Array.isArray(current)) throw Error('저장된 테스트 형식을 확인하세요.');
    const cases = [...current];
    const index = cases.findIndex(c => c?.id === m.id);
    if (m.op === 'add' && index < 0) {
      if (cases.length >= 64) throw Error('사용자 테스트는 문제당 64개까지 저장할 수 있어요.');
      cases.push({ id: m.id, input: '', expected: '', on: true, compare: false });
    } else if (m.op === 'add' || m.op === 'remove' && index < 0) {
      return { ok: true };
    } else if (index >= 0) {
      if (m.op === 'remove') cases.splice(index, 1);
      else if (m.op === 'move' && idOK(m.before) && m.before !== m.id) {
        const dest = cases.findIndex(c => c?.id === m.before);
        if (dest < 0) return { ok: false };
        const [moved] = cases.splice(index, 1);
        cases.splice(dest, 0, moved);
      } else if (m.op === 'edit') {
        if (!['input','expected','name','compare','on'].includes(m.field)) return { ok: false };
        if (['compare','on'].includes(m.field) ? typeof m.value !== 'boolean' :
          typeof m.value !== 'string' || m.value.length > (m.field === 'name' ? 64 : 524288)) return { ok: false };
        cases[index] = { ...cases[index], [m.field]: m.value };
      }
    } else return { ok: false };
    await chrome.storage.local.set({ [key]: cases });
    return { ok: true };
  }
  return (m, sender) => {
    const next = queue.then(() => change(m, sender));
    queue = next.catch(() => {});
    return next.catch(error => ({ ok: false, error: error.message }));
  };
})();
