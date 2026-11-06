import { filterLanguages, LanguageOption } from '../src/config';

const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = '') => { const node = document.createElement(tag); node.className = className; node.textContent = text; return node; };
let nextId = 0;

/** Searchable dropdown shared by the panel and the sidebar. */
export function languagePicker(onSelect: (id: string) => void, names = { title: 'Language', search: 'Search languages', empty: 'No matching languages', unset: '' }) {
  const id = `language-list-${nextId++}`;
  const root = make('div', 'picker');
  const trigger = make('button', 'picker-trigger');
  const triggerLabel = make('span', 'picker-label');
  trigger.type = 'button'; trigger.setAttribute('aria-haspopup', 'listbox'); trigger.setAttribute('aria-expanded', 'false'); trigger.title = names.title;
  trigger.append(triggerLabel, make('span', 'picker-chevron', '⌄'));
  const popup = make('div', 'picker-popup');
  const search = make('input', 'picker-search');
  search.type = 'text'; search.placeholder = names.search; search.setAttribute('role', 'combobox'); search.setAttribute('aria-controls', id); search.setAttribute('aria-expanded', 'true'); search.setAttribute('aria-label', names.search);
  const list = make('ul', 'picker-list');
  list.id = id; list.setAttribute('role', 'listbox');
  popup.append(search, list); popup.hidden = true;
  root.append(trigger, popup);

  let options: LanguageOption[] = [], shown: LanguageOption[] = [], value = '', active = 0;
  const paint = () => {
    shown = filterLanguages(options, search.value);
    active = Math.min(active, Math.max(shown.length - 1, 0));
    list.replaceChildren(...(shown.length ? shown.map((option, index) => {
      const item = make('li', 'picker-option' + (index === active ? ' active' : '') + (option.id === value ? ' current' : ''), option.label);
      item.id = `${id}-${index}`; item.setAttribute('role', 'option'); item.setAttribute('aria-selected', String(option.id === value));
      item.addEventListener('mousedown', event => { event.preventDefault(); choose(option); });
      return item;
    }) : [make('li', 'picker-empty', names.empty)]));
    if (shown.length) { search.setAttribute('aria-activedescendant', `${id}-${active}`); list.children[active]?.scrollIntoView({ block: 'nearest' }); }
    else search.removeAttribute('aria-activedescendant');
  };
  const close = (refocus = false) => { popup.hidden = true; trigger.setAttribute('aria-expanded', 'false'); if (refocus) trigger.focus(); };
  const open = () => { search.value = ''; active = Math.max(options.findIndex(option => option.id === value), 0); popup.hidden = false; trigger.setAttribute('aria-expanded', 'true'); paint(); search.focus(); };
  const choose = (option: LanguageOption) => { close(true); if (option.id !== value) onSelect(option.id); };
  trigger.addEventListener('click', () => popup.hidden ? open() : close());
  search.addEventListener('input', () => { active = 0; paint(); });
  search.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') { event.preventDefault(); active = (active + 1) % Math.max(shown.length, 1); paint(); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); active = (active - 1 + Math.max(shown.length, 1)) % Math.max(shown.length, 1); paint(); }
    else if (event.key === 'Enter') { event.preventDefault(); const option = shown[active]; if (option) choose(option); }
    else if (event.key === 'Escape') { event.preventDefault(); close(true); }
  });
  document.addEventListener('mousedown', event => { if (!root.contains(event.target as Node)) close(); });
  window.addEventListener('blur', () => close());
  return {
    root,
    update(next: LanguageOption[], selected: string, disabled: boolean) {
      options = next; value = selected;
      triggerLabel.textContent = options.find(option => option.id === value)?.label ?? names.unset;
      trigger.disabled = disabled;
      if (disabled) close();
      if (!popup.hidden) paint();
    },
  };
}
