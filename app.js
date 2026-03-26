/**
 * Base de datos de prompt injections.
 * Cada ataque tiene un id único; se pueden listar, ver, editar y eliminar.
 */

const form = document.getElementById('injection-form');
const promptInput = document.getElementById('prompt');
const typeInput = document.getElementById('type');
const modelInput = document.getElementById('model');
const sourceInput = document.getElementById('source');
const typeTagsContainer = document.getElementById('type-tags');
const modelTagsContainer = document.getElementById('model-tags');
const jsonOutput = document.getElementById('json-output');
const btnAdd = document.getElementById('btn-add');
const btnCancelEdit = document.getElementById('btn-cancel-edit');
const btnDownload = document.getElementById('btn-download');
const entriesList = document.getElementById('entries-list');
const entryDetail = document.getElementById('entry-detail');
const entryDetailBody = document.getElementById('entry-detail-body');
const btnCloseDetail = document.getElementById('btn-close-detail');
const btnEditEntry = document.getElementById('btn-edit-entry');
const btnDeleteEntry = document.getElementById('btn-delete-entry');
const editingIndicator = document.getElementById('editing-indicator');
const editingIdSpan = document.getElementById('editing-id');
const searchInput = document.getElementById('search-entries');
const searchCount = document.getElementById('search-count');
const typeSuggestionsEl = document.getElementById('type-suggestions');
const modelSuggestionsEl = document.getElementById('model-suggestions');

/** Base de datos en memoria. Se persiste en data.json vía API. */
let database = [];

/** Cuántos ítems mostrar en la lista antes de "Mostrar más" (para no cargar 200 de golpe). */
const LIST_PAGE_SIZE = 40;
let listVisibleCount = LIST_PAGE_SIZE;

/** Clave localStorage por si el servidor no está disponible. */
const STORAGE_KEY = 'prompt-injection-db';

/** Si estamos usando solo localStorage (servidor no disponible). */
let usingLocalStorageOnly = false;

function showStorageBanner(show) {
  const banner = document.getElementById('storage-banner');
  if (banner) banner.hidden = !show;
}

/**
 * Carga la base de datos: primero intenta el servidor (data.json); si falla, usa localStorage.
 */
async function loadFromServer() {
  try {
    const res = await fetch('/api/data');
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) {
        database = data;
        usingLocalStorageOnly = false;
        showStorageBanner(false);
        return;
      }
    }
  } catch (_) {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (Array.isArray(data)) database = data;
    }
    usingLocalStorageOnly = true;
    showStorageBanner(true);
  } catch (_) {
    database = [];
    showStorageBanner(true);
  }
}

/**
 * Guarda la base de datos: intenta servidor (data.json); si falla, guarda en localStorage.
 */
async function saveToServer() {
  try {
    const res = await fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(database),
    });
    if (res.ok) {
      usingLocalStorageOnly = false;
      showStorageBanner(false);
      return;
    }
  } catch (e) {
    console.error('Error al guardar en servidor:', e);
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(database));
    usingLocalStorageOnly = true;
    showStorageBanner(true);
  } catch (_) {}
}

/** Intervalo de polling para detectar cambios externos (otra pestaña, edición de data.json), en ms. */
const POLL_INTERVAL_MS = 3000;

/**
 * Compara dos arrays de entradas de forma estable (por id) para ver si son equivalentes.
 */
function dataEquals(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  const byId = (arr) => [...arr].sort((x, y) => (x.id || '').localeCompare(y.id || ''));
  return JSON.stringify(byId(a)) === JSON.stringify(byId(b));
}

/**
 * Comprueba si hay cambios en el servidor y actualiza la vista en vivo.
 */
async function pollForUpdates() {
  if (document.hidden || usingLocalStorageOnly) return;
  try {
    const res = await fetch('/api/data');
    if (!res.ok) return;
    const data = await res.json();
    if (!Array.isArray(data)) return;
    if (dataEquals(database, data)) return;
    database = data;
    updateJsonPreview();
    renderEntriesList();
    if (selectedId && !database.some((e) => e.id === selectedId)) closeDetail();
  } catch (_) {}
}

/** Id de la entrada que se está editando (null = modo nuevo). */
let editingId = null;

/** Id de la entrada seleccionada para ver detalle (null = ninguno). */
let selectedId = null;

/** Tags de tipo ya confirmados (Enter o clic en sugerencia). El input solo tiene el texto en curso. */
let typeTagsList = [];

/** Tags de modelo ya confirmados. */
let modelTagsList = [];

/**
 * Genera un identificador único para cada ataque.
 * @returns {string}
 */
function generateId() {
  return crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Parsea el campo "tipo" en un array de strings (trim, sin vacíos).
 */
function parseTypes(raw) {
  if (!raw || typeof raw !== 'string') return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Parsea el campo "modelo" en un array de strings (trim, sin vacíos).
 */
function parseModels(raw) {
  if (!raw || typeof raw !== 'string') return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

/** Tipos únicos de la base de datos (para sugerencias). */
function getUniqueTypes() {
  const set = new Set();
  database.forEach((e) => {
    if (Array.isArray(e.type)) e.type.forEach((t) => set.add(String(t).trim()));
  });
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** Modelos únicos de la base de datos (para sugerencias). Soporta model como string o array. */
function getUniqueModels() {
  const set = new Set();
  database.forEach((e) => {
    if (Array.isArray(e.model)) e.model.forEach((m) => set.add(String(m).trim()));
    else if (e.model && String(e.model).trim()) set.add(String(e.model).trim());
  });
  return [...set].sort((a, b) => a.localeCompare(b));
}

/**
 * Normaliza escapes literales que vienen de JSON copiado/pegado en el textarea.
 * Convierte:
 * - \\n -> salto de línea real
 * - \\t -> tab real
 * - \\r -> retorno de carro real
 */
function normalizePromptEscapes(input) {
  if (typeof input !== 'string') return input;
  let out = input;
  if (!out.includes('\\n') && !out.includes('\\t') && !out.includes('\\r')) return out;
  return out
    .replace(/\\\\n/g, '\n')
    .replace(/\\\\t/g, '\t')
    .replace(/\\\\r/g, '\r')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '\r');
}

/**
 * Añade un tipo a la lista confirmada y vacía el input para seguir escribiendo.
 */
function appendType(tag) {
  const t = String(tag).trim();
  if (!t || typeTagsList.includes(t)) return;
  typeTagsList.push(t);
  typeInput.value = '';
  renderTypeTags();
  updateJsonPreview();
  renderExistingTypes();
}

function showTypeSuggestions() {
  const raw = typeInput.value.trim();
  const word = raw.toLowerCase();
  const alreadyAdded = [...typeTagsList, ...parseTypes(typeInput.value)];
  const all = getUniqueTypes();
  let filtered = word ? all.filter((t) => t.toLowerCase().includes(word)) : all;
  filtered = filtered.filter((t) => !alreadyAdded.includes(t));
  if (filtered.length === 0) {
    typeSuggestionsEl.hidden = true;
    return;
  }
  typeSuggestionsEl.innerHTML = filtered
    .map((t) => `<button type="button" class="suggestions-item" data-value="${escapeAttr(t)}">${escapeHtml(t)}</button>`)
    .join('');
  typeSuggestionsEl.hidden = false;
  typeSuggestionsEl.querySelectorAll('.suggestions-item').forEach((btn) => {
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      appendType(btn.dataset.value);
      typeSuggestionsEl.hidden = true;
      renderExistingTypes();
    });
  });
}

/** Renderiza la fila de tipos existentes (pills clicables). Si no hay ninguno, muestra hint. */
function renderExistingTypes() {
  const wrap = document.getElementById('existing-types-wrap');
  const container = document.getElementById('existing-types');
  const noHint = document.getElementById('no-types-hint');
  if (!wrap || !container || !noHint) return;
  const all = getUniqueTypes();
  const added = typeTagsList;
  if (all.length === 0) {
    wrap.hidden = true;
    noHint.hidden = false;
    return;
  }
  wrap.hidden = false;
  noHint.hidden = true;
  container.innerHTML = all
    .map((t) => {
      const isAdded = added.includes(t);
      return `<button type="button" class="existing-pill ${isAdded ? 'added' : ''}" data-value="${escapeAttr(t)}" ${isAdded ? 'disabled' : ''} title="${isAdded ? 'Ya añadido' : 'Clic para añadir'}">${escapeHtml(t)}${isAdded ? ' ✓' : ' +'}</button>`;
    })
    .join('');
  container.querySelectorAll('.existing-pill:not([disabled])').forEach((btn) => {
    btn.addEventListener('click', () => {
      appendType(btn.dataset.value);
      renderExistingTypes();
    });
  });
}

/** Añade un modelo a la lista confirmada y vacía el input para seguir escribiendo. */
function appendModel(model) {
  const m = String(model).trim();
  if (!m || modelTagsList.includes(m)) return;
  modelTagsList.push(m);
  modelInput.value = '';
  renderModelTags();
  updateJsonPreview();
  renderExistingModels();
}

/** Elimina un modelo de la lista por índice. */
function removeModelAtIndex(index) {
  if (index < 0 || index >= modelTagsList.length) return;
  modelTagsList.splice(index, 1);
  renderModelTags();
  updateJsonPreview();
  renderExistingModels();
}

/** Renderiza los tags de modelo (con × para quitar). */
function renderModelTags() {
  if (!modelTagsContainer) return;
  modelTagsContainer.innerHTML = '';
  modelTagsList.forEach((m, i) => {
    const span = document.createElement('span');
    span.className = 'tag tag-with-remove';
    span.innerHTML = `${escapeHtml(m)}<button type="button" class="tag-remove" data-index="${i}" aria-label="Quitar ${escapeAttr(m)}">×</button>`;
    span.querySelector('.tag-remove').addEventListener('click', (e) => {
      e.preventDefault();
      removeModelAtIndex(i);
    });
    modelTagsContainer.appendChild(span);
  });
}

/** Renderiza la fila de modelos existentes (pills clicables). */
function renderExistingModels() {
  const wrap = document.getElementById('existing-models-wrap');
  const container = document.getElementById('existing-models');
  const noHint = document.getElementById('no-models-hint');
  if (!wrap || !container || !noHint) return;
  const all = getUniqueModels();
  if (all.length === 0) {
    wrap.hidden = true;
    noHint.hidden = false;
    return;
  }
  wrap.hidden = false;
  noHint.hidden = true;
  const added = modelTagsList;
  container.innerHTML = all
    .map((m) => {
      const isAdded = added.includes(m);
      return `<button type="button" class="existing-pill ${isAdded ? 'added' : ''}" data-value="${escapeAttr(m)}" ${isAdded ? 'disabled' : ''} title="${isAdded ? 'Ya añadido' : 'Clic para añadir'}">${escapeHtml(m)}${isAdded ? ' ✓' : ' +'}</button>`;
    })
    .join('');
  container.querySelectorAll('.existing-pill:not([disabled])').forEach((btn) => {
    btn.addEventListener('click', () => {
      appendModel(btn.dataset.value);
      renderExistingModels();
    });
  });
}

function showModelSuggestions() {
  const raw = modelInput.value.trim();
  const word = raw.toLowerCase();
  const alreadyAdded = [...modelTagsList, ...parseModels(modelInput.value)];
  const all = getUniqueModels();
  let filtered = word ? all.filter((m) => m.toLowerCase().includes(word)) : all;
  filtered = filtered.filter((m) => !alreadyAdded.includes(m));
  if (filtered.length === 0) {
    modelSuggestionsEl.hidden = true;
    return;
  }
  modelSuggestionsEl.innerHTML = filtered
    .map((m) => `<button type="button" class="suggestions-item" data-value="${escapeAttr(m)}">${escapeHtml(m)}</button>`)
    .join('');
  modelSuggestionsEl.querySelectorAll('.suggestions-item').forEach((btn) => {
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      appendModel(btn.dataset.value);
      modelSuggestionsEl.hidden = true;
      renderExistingModels();
    });
  });
  modelSuggestionsEl.hidden = false;
}

/**
 * Construye el objeto de la entrada actual a partir del formulario (sin id).
 */
function getCurrentEntryData() {
  const prompt = normalizePromptEscapes(promptInput.value.trim());
  const types = [...typeTagsList, ...parseTypes(typeInput.value)].filter(Boolean);
  const models = [...modelTagsList, ...parseModels(modelInput.value)].filter(Boolean);
  const source = sourceInput.value.trim() || undefined;

  const entry = {
    prompt: prompt || undefined,
    type: types.length ? types : undefined,
    model: models.length ? models : undefined,
    source,
  };

  return Object.fromEntries(
    Object.entries(entry).filter(([, v]) => v !== undefined && v !== '' && (!Array.isArray(v) || v.length > 0))
  );
}

/**
 * Elimina un tipo de la lista confirmada por índice.
 */
function removeTypeAtIndex(index) {
  if (index < 0 || index >= typeTagsList.length) return;
  typeTagsList.splice(index, 1);
  renderTypeTags();
  updateJsonPreview();
  renderExistingTypes();
}

/**
 * Actualiza la vista de tags a partir de typeTagsList. Cada tag tiene × para eliminarlo.
 */
function renderTypeTags() {
  typeTagsContainer.innerHTML = '';
  typeTagsList.forEach((t, i) => {
    const span = document.createElement('span');
    span.className = 'tag tag-with-remove';
    span.innerHTML = `${escapeHtml(t)}<button type="button" class="tag-remove" data-index="${i}" aria-label="Quitar ${escapeAttr(t)}">×</button>`;
    const btn = span.querySelector('.tag-remove');
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      removeTypeAtIndex(i);
    });
    typeTagsContainer.appendChild(span);
  });
}

/**
 * Escapa HTML para mostrar en el JSON (solo para contenido dentro de spans).
 */
function escapeHtmlJson(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Genera HTML con resaltado de sintaxis para el JSON.
 */
function jsonToHighlightedHtml(value, indent = 0) {
  const pad = '  '.repeat(indent);
  const padInner = '  '.repeat(indent + 1);

  if (value === null) {
    return `<span class="json-null">null</span>`;
  }
  if (typeof value === 'boolean') {
    return `<span class="json-boolean">${value}</span>`;
  }
  if (typeof value === 'number') {
    return `<span class="json-number">${value}</span>`;
  }
  if (typeof value === 'string') {
    return `<span class="json-string">${escapeHtmlJson(JSON.stringify(value))}</span>`;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '<span class="json-bracket">[]</span>';
    const parts = value.map((v) => padInner + jsonToHighlightedHtml(v, indent + 1));
    return `<span class="json-bracket">[</span>\n${parts.join(',\n')}\n${pad}<span class="json-bracket">]</span>`;
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value);
    if (entries.length === 0) return '<span class="json-bracket">{}</span>';
    const lines = entries.map(([k, v]) => {
      const keyHtml = `<span class="json-key">"${escapeHtmlJson(k)}"</span>`;
      const valueHtml = jsonToHighlightedHtml(v, indent + 1);
      return `${padInner}${keyHtml}: ${valueHtml}`;
    });
    return `<span class="json-bracket">{</span>\n${lines.join(',\n')}\n${pad}<span class="json-bracket">}</span>`;
  }
  return '';
}

/**
 * Resumen en una línea de una entrada (para el cabecero colapsable).
 */
function entrySummary(entry) {
  const id = (entry && entry.id) ? String(entry.id).slice(0, 8) : '?';
  const prompt = (entry && entry.prompt) ? entry.prompt.replace(/\s+/g, ' ').trim() : '';
  const preview = prompt.length > 50 ? prompt.slice(0, 50) + '…' : prompt;
  return `${id} — ${preview || '(sin prompt)'}`;
}

/**
 * Actualiza el JSON mostrado con resaltado y cada objeto colapsable.
 */
function updateJsonPreview() {
  const current = getCurrentEntryData();
  const hasCurrent = Object.keys(current).length > 0;
  const display = hasCurrent
    ? [...database.map((e) => ({ ...e })), { ...current, id: editingId || generateId() }]
    : database;
  const codeEl = jsonOutput.querySelector('code');
  if (!codeEl) return;
  if (display.length === 0) {
    codeEl.innerHTML = '<span class="json-bracket">[]</span>';
    return;
  }
  const itemsHtml = display
    .map(
      (entry, i) =>
        `<span class="json-item-wrap">
  <button type="button" class="json-item-toggle" aria-expanded="true" data-index="${i}">
    <span class="json-item-icon">▼</span>
    <span class="json-item-summary">${escapeHtmlJson(entrySummary(entry))}</span>
  </button>
  <div class="json-item-body">${jsonToHighlightedHtml(entry)}</div>
</span>`
    )
    .join(',\n');
  codeEl.innerHTML = `<span class="json-bracket">[</span>\n${itemsHtml}\n<span class="json-bracket">]</span>`;

  codeEl.querySelectorAll('.json-item-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const expanded = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!expanded));
      const wrap = btn.closest('.json-item-wrap');
      if (wrap) wrap.classList.toggle('collapsed', expanded);
      const icon = btn.querySelector('.json-item-icon');
      if (icon) icon.textContent = expanded ? '▶' : '▼';
    });
  });
}

/**
 * Acorta texto para preview.
 */
function truncate(str, max) {
  if (!str || typeof str !== 'string') return '';
  return str.length <= max ? str : str.slice(0, max) + '…';
}

/**
 * Formatea id para mostrar (primeros 8 caracteres).
 */
function shortId(id) {
  return id ? String(id).slice(0, 8) : '';
}

/**
 * Devuelve el texto de búsqueda actual (normalizado).
 */
function getSearchQuery() {
  const q = searchInput && searchInput.value ? searchInput.value.trim() : '';
  return q.toLowerCase();
}

/**
 * Filtra entradas por búsqueda: prompt, tipo, modelo, fuente o id (sin distinguir mayúsculas).
 */
function filterEntries(entries, query) {
  if (!query) return entries;
  return entries.filter((entry) => {
    const prompt = (entry.prompt || '').toLowerCase();
    const types = Array.isArray(entry.type) ? entry.type.join(' ').toLowerCase() : '';
    const model = Array.isArray(entry.model) ? entry.model.join(' ').toLowerCase() : (entry.model || '').toLowerCase();
    const source = (entry.source || '').toLowerCase();
    const id = (entry.id || '').toLowerCase();
    return prompt.includes(query) || types.includes(query) || model.includes(query) || source.includes(query) || id.includes(query);
  });
}

/**
 * Renderiza la lista de ataques (cards), aplicando el filtro de búsqueda.
 */
function renderEntriesList() {
  const query = getSearchQuery();
  const filtered = filterEntries(database, query);

  if (searchCount) {
    if (database.length === 0) {
      searchCount.textContent = '';
    } else if (query && filtered.length !== database.length) {
      searchCount.textContent = `Mostrando ${filtered.length} de ${database.length}`;
    } else {
      searchCount.textContent = `${database.length} ${database.length === 1 ? 'ataque' : 'ataques'}`;
    }
  }

  if (database.length === 0) {
    entriesList.innerHTML = '<p class="entries-empty">Aún no hay ataques. Añade uno con el formulario.</p>';
    return;
  }

  if (filtered.length === 0) {
    entriesList.innerHTML = '<p class="entries-empty">Ningún ataque coincide con la búsqueda.</p>';
    return;
  }

  const ordered = [...filtered].reverse();
  const toShow = ordered.slice(0, listVisibleCount);
  const hasMore = ordered.length > listVisibleCount;
  const remaining = ordered.length - listVisibleCount;

  entriesList.innerHTML =
    toShow
      .map(
        (entry) => `
    <div class="entry-card-wrap" data-id="${escapeAttr(entry.id)}">
      <button type="button" class="entry-card" title="Ver detalle">
        <div class="entry-card-header">
          <span class="entry-card-id">${escapeHtml(shortId(entry.id))}</span>
        </div>
        <div class="entry-card-preview">${escapeHtml(truncate(entry.prompt, 60))}</div>
        ${(entry.type && entry.type.length) || (entry.model && (Array.isArray(entry.model) ? entry.model.length : entry.model)) ? `
        <div class="entry-card-meta">
          ${entry.type && entry.type.length ? entry.type.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('') : ''}
          ${entry.model && (Array.isArray(entry.model) ? entry.model.length : entry.model) ? (Array.isArray(entry.model) ? entry.model : [entry.model]).map((m) => `<span class="tag tag-model">${escapeHtml(m)}</span>`).join('') : ''}
        </div>
        ` : ''}
      </button>
      <button type="button" class="entry-card-edit" title="Editar">Editar</button>
      <button type="button" class="entry-card-delete" title="Eliminar" data-id="${escapeAttr(entry.id)}">Eliminar</button>
    </div>
  `
      )
      .join('') +
    (hasMore
      ? `<div class="list-load-more">
          <button type="button" id="btn-show-more" class="btn-show-more">Mostrar más (${remaining} restantes)</button>
        </div>`
      : '');

  entriesList.querySelectorAll('.entry-card').forEach((btn) => {
    btn.addEventListener('click', () => {
      const wrap = btn.closest('.entry-card-wrap');
      if (wrap) {
        selectedId = wrap.dataset.id;
        openDetail(selectedId);
      }
    });
  });

  entriesList.querySelectorAll('.entry-card-edit').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const wrap = btn.closest('.entry-card-wrap');
      if (wrap) startEditing(wrap.dataset.id);
    });
  });

  entriesList.querySelectorAll('.entry-card-delete').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      if (id && confirm('¿Eliminar este ataque?')) deleteEntry(id);
    });
  });

  const btnShowMore = document.getElementById('btn-show-more');
  if (btnShowMore) {
    btnShowMore.addEventListener('click', () => {
      listVisibleCount += LIST_PAGE_SIZE;
      renderEntriesList();
    });
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return String(str).replace(/"/g, '&quot;');
}

/**
 * Abre el panel de detalle de una entrada.
 */
function openDetail(id) {
  const entry = database.find((e) => e.id === id);
  if (!entry) return;

  selectedId = id;
  entryDetail.hidden = false;

  entryDetailBody.innerHTML = `
    <div class="detail-row">
      <span class="detail-label">Id</span>
      <div class="detail-value detail-id">${escapeHtml(entry.id)}</div>
    </div>
    <div class="detail-row detail-prompt-wrap">
      <span class="detail-label">Prompt</span>
      <div class="detail-prompt-actions">
        <button type="button" class="btn-copy" data-entry-id="${escapeAttr(entry.id)}" title="Copiar al portapapeles">Copiar</button>
      </div>
      <div class="prompt-block-scroll">${escapeHtml(entry.prompt || '')}</div>
    </div>
    ${entry.type && entry.type.length ? `
    <div class="detail-row">
      <div class="detail-label">Tipo</div>
      <div class="detail-value"><span class="tags">${entry.type.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</span></div>
    </div>
    ` : ''}
    ${entry.model && (Array.isArray(entry.model) ? entry.model.length : entry.model) ? `
    <div class="detail-row">
      <div class="detail-label">Modelo</div>
      <div class="detail-value">${escapeHtml(Array.isArray(entry.model) ? entry.model.join(', ') : entry.model)}</div>
    </div>
    ` : ''}
    ${entry.source ? `
    <div class="detail-row">
      <div class="detail-label">Fuente</div>
      <div class="detail-value">${entry.source.startsWith('http') ? `<a href="${escapeAttr(entry.source)}" target="_blank" rel="noopener">${escapeHtml(entry.source)}</a>` : escapeHtml(entry.source)}</div>
    </div>
    ` : ''}
  `;

  entryDetailBody.querySelectorAll('.btn-copy').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-entry-id');
      const entry = database.find((e) => e.id === id);
      const text = entry ? (entry.prompt || '') : '';
      navigator.clipboard.writeText(text).then(() => {
        const label = btn.textContent;
        btn.textContent = 'Copiado';
        setTimeout(() => { btn.textContent = label; }, 1500);
      });
    });
  });
}

/**
 * Cierra el panel de detalle.
 */
function closeDetail() {
  selectedId = null;
  entryDetail.hidden = true;
}

/**
 * Rellena el formulario con una entrada (para editar).
 */
function fillForm(entry) {
  promptInput.value = normalizePromptEscapes(entry.prompt || '');
  typeTagsList = Array.isArray(entry.type) ? [...entry.type] : entry.type ? [entry.type] : [];
  modelTagsList = Array.isArray(entry.model) ? [...entry.model] : entry.model ? [entry.model] : [];
  typeInput.value = '';
  modelInput.value = '';
  sourceInput.value = entry.source || '';
  renderTypeTags();
  renderModelTags();
  updateJsonPreview();
  renderExistingTypes();
  renderExistingModels();
}

/**
 * Activa modo edición para una entrada.
 */
function startEditing(id) {
  const entry = database.find((e) => e.id === id);
  if (!entry) return;

  closeDetail();
  editingId = id;
  fillForm(entry);

  btnAdd.textContent = 'Guardar cambios';
  btnCancelEdit.hidden = false;
  editingIndicator.hidden = false;
  editingIdSpan.textContent = shortId(id);
  setView('new');
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * Sale del modo edición (nuevo ataque).
 */
function cancelEditing() {
  editingId = null;
  btnAdd.textContent = 'Añadir a la base de datos';
  btnCancelEdit.hidden = true;
  editingIndicator.hidden = true;
  typeTagsList = [];
  modelTagsList = [];
  form.reset();
  renderTypeTags();
  renderModelTags();
  renderExistingTypes();
  renderExistingModels();
  updateJsonPreview();
  renderEntriesList();
}

/**
 * Comprueba si ya existe una entrada con el mismo texto de prompt (evitar duplicados).
 * Al editar, se ignora la entrada actual.
 */
function isDuplicatePrompt(promptText, excludeId) {
  const normalized = (promptText || '').trim();
  if (!normalized) return false;
  return database.some((e) => e.id !== excludeId && (e.prompt || '').trim() === normalized);
}

function showDuplicatePromptMessage() {
  const el = document.getElementById('duplicate-prompt-msg');
  if (el) el.hidden = false;
}

function hideDuplicatePromptMessage() {
  const el = document.getElementById('duplicate-prompt-msg');
  if (el) el.hidden = true;
}

/**
 * Añade o actualiza la entrada.
 */
function saveEntry(e) {
  e.preventDefault();
  const data = getCurrentEntryData();
  if (!data.prompt) {
    promptInput.focus();
    return;
  }

  if (!editingId && isDuplicatePrompt(data.prompt, null)) {
    showDuplicatePromptMessage();
    promptInput.focus();
    return;
  }

  hideDuplicatePromptMessage();

  if (editingId) {
    const index = database.findIndex((e) => e.id === editingId);
    if (index !== -1) {
      database[index] = { ...database[index], ...data };
    }
    cancelEditing();
  } else {
    database.push({ id: generateId(), ...data });
    typeTagsList = [];
    modelTagsList = [];
    form.reset();
    renderTypeTags();
    renderModelTags();
  }

  updateJsonPreview();
  renderEntriesList();
  renderExistingTypes();
  renderExistingModels();
  saveToServer();
  promptInput.focus();
}

/**
 * Elimina una entrada por id.
 */
function deleteEntry(id) {
  database = database.filter((e) => e.id !== id);
  closeDetail();
  if (editingId === id) cancelEditing();
  updateJsonPreview();
  renderEntriesList();
  renderExistingTypes();
  renderExistingModels();
  saveToServer();
}

// Eventos: tipo — Enter añade tag y pasa al siguiente campo (no envía el form)
typeInput.addEventListener('input', () => {
  renderTypeTags();
  updateJsonPreview();
  showTypeSuggestions();
  renderExistingTypes();
});
typeInput.addEventListener('blur', () => {
  setTimeout(() => { if (typeSuggestionsEl) typeSuggestionsEl.hidden = true; }, 180);
  renderTypeTags();
});
typeInput.addEventListener('focus', () => showTypeSuggestions());
typeInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const raw = typeInput.value.trim();
  if (raw) {
    parseTypes(raw).forEach((t) => {
      if (t && !typeTagsList.includes(t)) typeTagsList.push(t);
    });
    typeInput.value = '';
    renderTypeTags();
    updateJsonPreview();
    renderExistingTypes();
  }
  modelInput.focus();
});

// Eventos: modelo — múltiples, Enter añade y pasa al siguiente campo
modelInput.addEventListener('input', () => {
  renderModelTags();
  updateJsonPreview();
  showModelSuggestions();
  renderExistingModels();
});
modelInput.addEventListener('focus', () => showModelSuggestions());
modelInput.addEventListener('blur', () => {
  setTimeout(() => { if (modelSuggestionsEl) modelSuggestionsEl.hidden = true; }, 180);
  renderModelTags();
});
modelInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const raw = modelInput.value.trim();
  if (raw) {
    parseModels(raw).forEach((m) => {
      if (m && !modelTagsList.includes(m)) modelTagsList.push(m);
    });
    modelInput.value = '';
    renderModelTags();
    updateJsonPreview();
    renderExistingModels();
  }
  sourceInput.focus();
});

promptInput.addEventListener('input', () => {
  updateJsonPreview();
  hideDuplicatePromptMessage();
});
sourceInput.addEventListener('input', updateJsonPreview);

if (searchInput) {
  searchInput.addEventListener('input', () => {
    listVisibleCount = LIST_PAGE_SIZE;
    renderEntriesList();
  });
}

form.addEventListener('submit', saveEntry);
btnCancelEdit.addEventListener('click', cancelEditing);
btnDownload.addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(database, null, 2)], {
    type: 'application/json',
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'prompt-injections.json';
  a.click();
  URL.revokeObjectURL(a.href);
});

btnCloseDetail.addEventListener('click', closeDetail);
btnEditEntry.addEventListener('click', () => {
  if (selectedId) startEditing(selectedId);
});
btnDeleteEntry.addEventListener('click', () => {
  if (selectedId) {
    if (confirm('¿Eliminar este ataque?')) deleteEntry(selectedId);
  }
});

// Cambio de vista (3 apartados, 1 visible)
const VIEW_KEY = 'prompt-injection-db-view';
let currentView = 'new';

function setView(view) {
  const wasNew = currentView === 'new';
  currentView = view;
  document.querySelectorAll('.view-tab').forEach((tab) => {
    const isActive = tab.dataset.view === view;
    tab.classList.toggle('active', isActive);
    tab.setAttribute('aria-selected', isActive);
  });
  document.querySelectorAll('.view-panel').forEach((panel) => {
    panel.hidden = panel.dataset.panel !== view;
  });
  if (wasNew && view !== 'new' && !editingId) {
    typeTagsList = [];
    modelTagsList = [];
    if (typeInput) typeInput.value = '';
    if (modelInput) modelInput.value = '';
    renderTypeTags();
    renderModelTags();
    renderExistingTypes();
    renderExistingModels();
    updateJsonPreview();
  }
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch (_) {}
}

document.querySelectorAll('.view-tab').forEach((tab) => {
  tab.addEventListener('click', () => setView(tab.dataset.view));
});

try {
  const saved = localStorage.getItem(VIEW_KEY);
  if (saved === 'new' || saved === 'list' || saved === 'json') setView(saved);
} catch (_) {}

// Inicial: cargar desde data.json (API) y luego renderizar
(async function init() {
  await loadFromServer();
  renderTypeTags();
  renderModelTags();
  renderExistingTypes();
  renderExistingModels();
  updateJsonPreview();
  renderEntriesList();

  // Actualización en vivo: polling cada POLL_INTERVAL_MS (solo con servidor y pestaña visible)
  setInterval(pollForUpdates, POLL_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) pollForUpdates();
  });
})();
