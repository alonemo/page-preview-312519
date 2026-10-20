const template = document.createElement('template');
template.innerHTML = `
  <style>
    :host { display: block; max-width: 32rem; margin-block: 1rem; }
    article { border: 1px solid #ccc7bc; border-left: 3px solid #36624b;
      padding: 1rem 1.25rem; background: #fffdf8; color: #262b27; }
    a { display: block; color: #24533c; font: 600 1.15rem Georgia, serif;
      overflow-wrap: anywhere; text-underline-offset: .2em; }
    [part="heading"] { display: block; margin-top: .65rem; white-space: pre-wrap; }
    p { margin: .5rem 0 0; font-size: .9rem; }
    p:empty { display: none; }
  </style>
  <article>
    <a part="link"><span part="title"></span></a>
    <span part="heading"></span>
    <p role="status"></p>
  </article>
`;

export class PagePreview extends HTMLElement {
  static observedAttributes = ['src'];
  #controller;
  #generation = 0;
  #connected = false;
  #link;
  #title;
  #heading;
  #message;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.append(template.content.cloneNode(true));
    this.#link = root.querySelector('[part="link"]');
    this.#title = root.querySelector('[part="title"]');
    this.#heading = root.querySelector('[part="heading"]');
    this.#message = root.querySelector('[role="status"]');
  }

  connectedCallback() {
    this.#connected = true;
    this.#load();
  }

  disconnectedCallback() {
    this.#connected = false;
    this.#generation++;
    this.#controller?.abort();
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue !== newValue && this.#connected) this.#load();
  }

  async #load() {
    this.#controller?.abort();
    const generation = ++this.#generation;
    this.#title.textContent = '';
    this.#heading.textContent = '';
    this.#link.removeAttribute('href');
    this.#link.querySelector('[data-url]')?.remove();
    this.#message.textContent = 'Загрузка…';
    this.dataset.status = 'loading';
    try {
      const src = this.getAttribute('src');
      if (!src?.trim()) throw new Error('Не указан адрес страницы');
      const url = new URL(src, document.baseURI);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Нужен HTTP или HTTPS');
      this.#link.href = url.href;
      this.#title.textContent = url.href;
      this.#controller = new AbortController();
      const response = await fetch(url.href, { signal: this.#controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await response.text();
      if (!this.isConnected || generation !== this.#generation) return;
      const page = new DOMParser().parseFromString(html, 'text/html');
      const title = page.title.trim();
      this.#title.textContent = title || 'Название отсутствует';
      // Without a title, the visible link must still contain the resolved URL.
      if (!title) {
        const fallback = document.createElement('span');
        fallback.dataset.url = '';
        fallback.textContent = ` (${url.href})`;
        this.#link.append(fallback);
      }
      this.#heading.textContent = page.querySelector('h1')?.textContent.trim() || 'Заголовок отсутствует';
      this.#message.textContent = '';
      this.dataset.status = 'ready';
    } catch (error) {
      if (!this.isConnected || generation !== this.#generation) return;
      this.#message.textContent = `Не удалось загрузить страницу: ${error.message}`;
      this.dataset.status = 'error';
    }
  }
}

if (!customElements.get('page-preview')) customElements.define('page-preview', PagePreview);
