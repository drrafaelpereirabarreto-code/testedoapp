// Aviso de privacidade (LGPD) mostrado só na primeira visita.
(function () {
  try { if (localStorage.getItem('imed_lgpd')) return; } catch (e) {}
  var base = (document.currentScript && document.currentScript.getAttribute('data-base')) || '';
  var css = document.createElement('style');
  css.textContent = '.lgpd{position:fixed;left:20px;bottom:20px;z-index:55;display:flex;align-items:center;gap:12px;max-width:440px;padding:14px 16px;border-radius:18px;background:#0F1F28;color:rgba(255,255,255,.88);font:14px/1.5 Inter,system-ui,sans-serif;box-shadow:0 24px 60px rgba(5,22,30,.4);animation:lgpdIn .5s cubic-bezier(.2,.8,.2,1)}'
    + '.lgpd i{color:#7FF0E4;font-size:18px}.lgpd a{color:#fff;font-weight:700;text-decoration:underline}'
    + '.lgpd button{flex-shrink:0;min-height:44px;padding:9px 16px;border:0;border-radius:11px;background:#B83A20;color:#fff;font:700 14px Inter,system-ui,sans-serif;cursor:pointer}'
    + '.lgpd button:focus-visible,.lgpd a:focus-visible{outline:3px solid #7FF0E4;outline-offset:2px}'
    + '@keyframes lgpdIn{from{opacity:0;transform:translateY(16px)}}'
    + '@media (prefers-reduced-motion:reduce){.lgpd{animation:none}}'
    + 'body:has(.bagbar:not(.hide)) .lgpd{bottom:96px}'
    + '@media (max-width:860px){.lgpd{left:12px;right:12px;max-width:none;bottom:calc(84px + env(safe-area-inset-bottom))}body:has(.bagbar:not(.hide)) .lgpd{bottom:calc(152px + env(safe-area-inset-bottom))}}';
  document.head.appendChild(css);
  var d = document.createElement('div');
  d.className = 'lgpd'; d.setAttribute('role', 'region'); d.setAttribute('aria-label', 'Aviso de privacidade');
  d.innerHTML = '<i class="fa-solid fa-shield-halved" aria-hidden="true"></i><span>Usamos só o necessário: a localização só com sua permissão, para buscar clínicas, e sem guardá-la. Os formulários seguem a LGPD. <a href="' + base + 'privacidade.html">Política de privacidade</a></span><button type="button">Entendi</button>';
  // Enquanto o aviso está na tela, a página rola deixando o espaço dele livre: o que recebe o foco pelo Tab
  // nunca fica escondido atrás do aviso.
  var root = document.documentElement;
  var pad = function () { if (!d.isConnected) return; var t = d.getBoundingClientRect().top; root.style.scrollPaddingBottom = Math.max(0, Math.round(innerHeight - t + 28)) + 'px'; };
  d.querySelector('button').onclick = function () {
    try { localStorage.setItem('imed_lgpd', '1'); } catch (e) {}
    d.remove(); removeEventListener('resize', pad); root.style.removeProperty('scroll-padding-bottom');
  };
  var add = function () { document.body.appendChild(d); pad(); addEventListener('resize', pad); };
  if (document.body) add(); else addEventListener('DOMContentLoaded', add);
})();
