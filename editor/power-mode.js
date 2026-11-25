// One transient drawing surface per enabled editor. All input still belongs to Monaco.
const palettes = {
  spark: ['#ffbe59', '#ff744a', '#f95767', '#ffe3a3'],
  aurora: ['#54d7cc', '#74adff', '#ae8cff', '#d2f3ef'],
  pixel: ['#f38cbe', '#8bb3ff', '#70dda9', '#f6d581'],
};
export class PowerMode {
  constructor(view, container) {
    this.view = view;
    this.container = container;
    this.particles = [];
    this.motion = matchMedia('(prefers-reduced-motion: reduce)');
    this.clear = () => {
      cancelAnimationFrame(this.frame);
      clearTimeout(this.comboTimer);
      this.shake?.cancel();
      this.particles.length = this.frame = this.combo = this.lastType = 0;
      this.canvas?.remove();
      this.canvas = this.ctx = null;
      this.count?.remove();
      this.count = null;
    };
    this.clear();
    this.motion.addEventListener('change', this.clear);
    document.addEventListener('visibilitychange', this.clear);
    this.typed = view.onDidType(text => {
      if (!view.inComposition && !document.hidden && !this.motion.matches && view.hasTextFocus() && text.length <= 2) this.emit();
    });
    this.listeners = [view.onDidCompositionStart(this.clear), view.onDidScrollChange(this.clear), view.onDidBlurEditorText(this.clear)];
  }
  emit() {
    const now = performance.now();
    const pos = this.view.getScrolledVisiblePosition(this.view.getPosition());
    if (!pos || pos.left < 0 || pos.top < 0 || pos.top >= this.container.clientHeight) return;
    if (!this.canvas) {
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'typing-particles';
      this.canvas.setAttribute('aria-hidden', 'true');
      this.container.append(this.canvas);
      this.ctx = this.canvas.getContext('2d');
    }
    const w = this.container.clientWidth, h = this.container.clientHeight;
    const scale = Math.min(devicePixelRatio, 1.5, 1920 / w, 1200 / h);
    if (this.canvas.width !== Math.round(w * scale) || this.canvas.height !== Math.round(h * scale)) {
      this.canvas.width = Math.round(w * scale); this.canvas.height = Math.round(h * scale);
      this.ctx.setTransform(scale, 0, 0, scale, 0, 0);
    }
    this.combo = now - this.lastType < 1100 ? this.combo + 1 : 1;
    this.lastType = now;
    const burst = this.combo % 10 === 0;
    const preset = this.settings.preset, colors = palettes[preset] || palettes.spark;
    const count = ({ low: 3, medium: 6, high: 9 }[this.settings.intensity] || 6) * (burst ? 3 : 1);
    for (let i = 0; i < count; i++) {
      const angle = burst ? Math.random() * Math.PI * 2 : -Math.PI * (.1 + Math.random() * .83);
      const speed = (burst ? 95 : 55) + Math.random() * 80;
      this.particles.push({ x: pos.left + 2, y: pos.top + pos.height * .72, vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed, born: now, life: 270 + Math.random() * 350, color: colors[i % colors.length],
        size: (burst ? 2 : 1) + Math.random() * 2, preset });
    }
    this.particles.splice(0, Math.max(0, this.particles.length - 96));
    if (this.combo >= 5) {
      if (!this.count) {
        this.count = document.createElement('span'); this.count.className = 'typing-combo';
        this.count.setAttribute('aria-hidden', 'true'); this.container.append(this.count);
      }
      this.count.textContent = this.combo + ' ×';
      this.count.style.color = colors[burst ? 1 : 0];
      clearTimeout(this.comboTimer);
      this.comboTimer = setTimeout(() => { this.count?.remove(); this.count = null; }, 1050);
    }
    if (burst && this.settings.shake) {
      this.shake?.cancel();
      this.shake = this.container.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(1.5px)' },
        { transform: 'translateX(-1px)' }, { transform: 'translateX(0)' }], 105);
    }
    if (!this.frame) { this.lastFrame = now; this.frame = requestAnimationFrame(time => this.draw(time)); }
  }
  draw(now) {
    const dt = Math.min(40, now - this.lastFrame) / 1000;
    this.lastFrame = now;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.container.clientWidth, this.container.clientHeight);
    this.particles = this.particles.filter(p => now - p.born < p.life);
    for (const p of this.particles) {
      ctx.fillStyle = ctx.strokeStyle = p.color;
      ctx.globalAlpha = Math.max(0, 1 - (now - p.born) / p.life);
      const x = p.x, y = p.y;
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += (p.preset === 'aurora' ? 65 : 210) * dt;
      if (p.preset === 'pixel') ctx.fillRect(Math.round(x), Math.round(y), p.size, p.size);
      else {
        ctx.lineCap = 'round'; ctx.lineWidth = p.size;
        ctx.beginPath(); ctx.moveTo(x - p.vx * .025, y - p.vy * .025); ctx.lineTo(p.x, p.y); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    this.frame = this.particles.length ? requestAnimationFrame(t => this.draw(t)) : 0;
    if (!this.frame) { this.canvas.remove(); this.canvas = this.ctx = null; }
  }
  dispose() {
    this.typed.dispose();
    for (const listener of this.listeners) listener.dispose();
    this.motion.removeEventListener('change', this.clear);
    document.removeEventListener('visibilitychange', this.clear);
    this.clear();
  }
}
