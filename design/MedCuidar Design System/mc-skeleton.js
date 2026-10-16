customElements.define('mc-skeleton', class extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return;
    const r = this.attachShadow({ mode: 'open' });
    const bar = (w, h, rad = 8) => `<div class="s" style="width:${w};height:${h}px;border-radius:${rad}px"></div>`;
    const card = `<div class="c"><div style="display:flex;gap:12px;align-items:center">${bar('48px', 48, 14)}<div style="flex:1;display:flex;flex-direction:column;gap:8px">${bar('40%', 20)}${bar('70%', 14)}</div></div>${bar('100%', 48, 12)}</div>`;
    r.innerHTML = `<style>
      :host{display:block}
      .f{width:390px;height:560px;border-radius:24px;overflow:hidden;border:1px solid #C9D2E3;background:#F3F6FC;padding:24px 16px;display:flex;flex-direction:column;gap:16px;font-family:'Atkinson Hyperlegible Next',system-ui,sans-serif}
      .c{background:#fff;border:1px solid #E3E8F2;border-radius:16px;padding:16px;display:flex;flex-direction:column;gap:14px}
      .s{background:linear-gradient(90deg,#E9EEF7 0%,#F5F7FB 50%,#E9EEF7 100%);background-size:200% 100%;animation:sh 1.4s ease-in-out infinite}
      .t{display:flex;align-items:center;gap:8px;color:#4A5670;font-size:15px}
      .sp{width:18px;height:18px;border-radius:50%;border:2.5px solid #DCE6FF;border-top-color:#1F56E0;animation:rot .9s linear infinite}
      @keyframes sh{0%{background-position:100% 0}100%{background-position:-100% 0}}
      @keyframes rot{to{transform:rotate(360deg)}}
      @media (prefers-reduced-motion:reduce){.s,.sp{animation:none}}
    </style>
    <div class="f" role="status" aria-label="Carregando">
      ${bar('55%', 28)}${bar('80%', 16)}
      ${card}${card}
      <div class="t"><span class="sp"></span>Carregando as doses de hoje…</div>
    </div>`;
  }
});
