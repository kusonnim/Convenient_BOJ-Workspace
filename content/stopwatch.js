// Storage events keep open tabs on the same problem in sync. Only a visible,
// running clock needs a repaint interval. Time itself survives tab closure.
class ProblemStopwatch {
  constructor(pid, h) {
    this.key = 'timer:' + pid;
    this.state = stopwatch.empty();
    this.changes = 0;
    this.button = h('button', { type: 'button', class: 'cboj-timer' });
    this.reset = h('button', { type: 'button', class: 'cboj-timer-reset', text: '↺', title: '풀이 시간 초기화', 'aria-label': '풀이 시간 초기화' });
    this.element = h('span', { class: 'cboj-clock' }, this.button, this.reset);
    this.button.onclick = e => {
      if (e.isTrusted) this.request(this.state.since === null ? 'start' : 'pause');
    };
    this.reset.onclick = e => {
      if (e.isTrusted && confirm('이 문제의 풀이 시간을 초기화할까요?')) this.request('reset');
    };
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[this.key]) { this.changes++; this.update(changes[this.key].newValue); }
    });
    document.addEventListener('visibilitychange', () => this.refresh());
    this.refresh();
  }
  async request(action) {
    const changes = this.changes;
    const state = await chrome.runtime.sendMessage({ type: 'cboj:timer', action }).catch(() => null);
    if (this.changes === changes && stopwatch.valid(state)) this.update(state);
  }
  update(state) { this.state = stopwatch.valid(state) ? state : stopwatch.empty(); this.refresh(); }
  show(visible) { this.visible = visible; this.refresh(); }
  refresh() {
    clearInterval(this.tick);
    const t = this.state, running = t.since !== null;
    const draw = () => { this.button.textContent = '⏱ ' + stopwatch.format(stopwatch.elapsed(t)); };
    draw();
    this.button.title = running ? '풀이 시간 일시정지' : t.solved !== null ? '정답 풀이 시간 · 다시 시작' : '풀이 시간 시작';
    this.button.setAttribute('aria-label', this.button.title);
    this.button.setAttribute('aria-pressed', String(running));
    this.element.classList.toggle('solved', t.solved !== null);
    this.reset.disabled = !running && !t.elapsed && t.solved === null;
    if (running && this.visible && !document.hidden) this.tick = setInterval(draw, 1000);
  }
}
