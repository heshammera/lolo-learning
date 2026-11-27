(() => {
  const assets = Object.freeze({
    logo: '/assets/branding/logos/lolo-logo.webp',
    icon: '/assets/branding/icons/lolo-icon.webp',
  });
  function render(root = document) {
    root.querySelectorAll('[data-brand]').forEach((placeholder) => {
      const source = assets[placeholder.dataset.brand];
      if (!source || placeholder.tagName === 'IMG') return;
      const image = document.createElement('img');
      image.className = placeholder.className;
      image.src = source;
      image.alt = placeholder.getAttribute('aria-label') || '';
      image.decoding = 'async';
      image.draggable = false;
      if (placeholder.getAttribute('aria-hidden') === 'true') image.alt = '';
      placeholder.replaceWith(image);
    });
  }
  window.LoloBrand = Object.freeze({ assets, render });
  render();
})();
