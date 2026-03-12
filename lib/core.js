'use strict';

function deepMerge(target, source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return target;
  const output = Object.assign({}, target);
  Object.keys(source).forEach((key) => {
    const sourceValue = source[key];
    const targetValue = output[key];

    if (Array.isArray(sourceValue)) {
      output[key] = sourceValue.slice();
      return;
    }

    if (sourceValue && typeof sourceValue === 'object') {
      output[key] = deepMerge(
        targetValue && typeof targetValue === 'object' && !Array.isArray(targetValue) ? targetValue : {},
        sourceValue
      );
      return;
    }

    output[key] = sourceValue;
  });
  return output;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function decodeEntities(text) {
  if (!text) return '';
  return String(text)
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function stripHtml(html) {
  if (!html) return '';
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
}

function normalizeWhitespace(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function asArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return [value];
}

function toNameArray(value) {
  return asArray(value)
    .map((entry) => {
      if (!entry) return null;
      if (typeof entry === 'string') return entry;
      if (typeof entry.name === 'string') return entry.name;
      return null;
    })
    .filter(Boolean);
}

function toIsoDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function getFieldValue(item, field) {
  if (!field) return undefined;
  return item[field];
}

function pathMatches(pathValue, patterns) {
  if (!pathValue || !patterns || !patterns.length) return false;
  return patterns.some((pattern) => String(pathValue).includes(String(pattern)));
}

function intersects(values, expected) {
  if (!Array.isArray(values) || !Array.isArray(expected) || !expected.length) return false;
  const set = new Set(values.map(String));
  return expected.some((value) => set.has(String(value)));
}

function boolOrObjectEnabled(value, defaultValue) {
  if (typeof value === 'boolean') return value;
  if (value && typeof value === 'object') {
    if (typeof value.enabled === 'boolean') return value.enabled;
    return defaultValue;
  }
  return defaultValue;
}

function normalizeSearchableOverride(raw) {
  if (raw === false) return { enabled: false, fields: {} };
  if (raw === true) return { enabled: true, fields: {} };
  if (!raw || typeof raw !== 'object') return { enabled: undefined, fields: {} };
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : undefined,
    boost: typeof raw.boost === 'number' ? raw.boost : undefined,
    excerpt: typeof raw.excerpt === 'string' ? raw.excerpt : undefined,
    fields: raw.fields && typeof raw.fields === 'object' ? raw.fields : {}
  };
}

function runHexoFilter(hexo, name, args) {
  if (!hexo || !hexo.extend || !hexo.extend.filter || typeof hexo.extend.filter.exec !== 'function') return;
  return hexo.extend.filter.exec(name, ...args);
}

function createSearchable(hexo) {
  const state = {
    collectors: [],
    transformers: [],
    documents: [],
    documentsById: new Map(),
    lastContext: null
  };

  const defaults = {
    enabled: true,
    collections: {
      posts: {
        enabled: true,
        filters: {}
      },
      pages: {
        enabled: true,
        filters: {}
      }
    },
    output: {
      mode: 'per-document',
      dir: 'search',
      file: 'search-index.json',
      pretty: true,
      include_index_file: true,
      per_document_pattern: ':collection/:id.json'
    },
    document: {
      id: {
        from: 'slug',
        prefix_collection: true
      },
      fields: {
        id: true,
        collection: true,
        title: true,
        url: true,
        path: false,
        source: false,
        publishedAt: true,
        lastUpdated: true,
        tags: true,
        categories: true,
        keywords: true,
        excerpt: true,
        content: true,
        boost: false
      },
      values: {
        excerpt: {
          fallback: 'content',
          max_length: 240
        },
        content: {
          strip_html: true,
          decode_entities: true,
          normalize_whitespace: true
        }
      }
    },
    transform: {
      remove_empty_fields: true,
      sort_by: 'publishedAt',
      sort_order: 'desc'
    }
  };

  function getConfig() {
    const userConfig = hexo.config && hexo.config.searchable ? hexo.config.searchable : {};
    return deepMerge(defaults, userConfig);
  }

  function buildUrl(pathValue) {
    try {
      const helper = hexo.extend.helper.get('url_for').bind(hexo);
      return helper(pathValue);
    } catch (error) {
      const root = (hexo.config && hexo.config.root) || '/';
      const cleanRoot = root.endsWith('/') ? root.slice(0, -1) : root;
      return `${cleanRoot}/${String(pathValue || '').replace(/^\//, '')}`.replace(/\/+/g, '/');
    }
  }

  function collectDefaultItems(locals, config) {
    const items = [];
    if (config.collections.posts && config.collections.posts.enabled && locals.posts) {
      locals.posts.toArray()
        .filter((post) => { return post.source.endsWith('.md') || post.source.endsWith('.markdown'); })
        .forEach((post) => { items.push({ collection: 'post', item: post }); });
    }
    if (config.collections.pages && config.collections.pages.enabled && locals.pages) {
      locals.pages.toArray()
        .filter((page) => { return page.source.endsWith('.md') || page.source.endsWith('.markdown'); })
        .forEach((page) => { items.push({ collection: 'page', item: page }); });
    }
    return items;
  }

  function normalizeCollectedEntry(entry) {
    if (!entry) return null;
    if (entry.collection && entry.item) return entry;
    return null;
  }

  function collectItems(locals, config) {
    const baseItems = collectDefaultItems(locals, config);
    const context = { hexo, config, locals, items: baseItems.slice() };

    runHexoFilter(hexo, 'searchable:collect', [context]);

    state.collectors.forEach((collector) => {
      const extra = collector.fn({ hexo, config, locals, items: context.items.slice() }) || [];
      asArray(extra).forEach((entry) => {
        const normalized = normalizeCollectedEntry(entry);
        if (normalized) context.items.push(normalized);
      });
    });

    return context.items;
  }

  function isPublished(item, collectionKey) {
    if (collectionKey === 'page') return true;
    return item.published !== false && item.draft !== true;
  }

  function getCollectionConfig(config, collectionKey) {
    return collectionKey === 'post' ? config.collections.posts : config.collections.pages;
  }

  function evaluateDateRule(item, rule) {
    if (!rule || !rule.field) return true;
    const value = getFieldValue(item, rule.field);
    if (!value) return false;
    const itemDate = new Date(value);
    if (Number.isNaN(itemDate.getTime())) return false;
    const now = new Date();

    if (typeof rule.within_last_days === 'number') {
      const cutoff = new Date(now);
      cutoff.setDate(cutoff.getDate() - rule.within_last_days);
      return itemDate >= cutoff;
    }

    if (typeof rule.newer_than_days === 'number') {
      const cutoff = new Date(now);
      cutoff.setDate(cutoff.getDate() - rule.newer_than_days);
      return itemDate >= cutoff;
    }

    if (typeof rule.older_than_days === 'number') {
      const cutoff = new Date(now);
      cutoff.setDate(cutoff.getDate() - rule.older_than_days);
      return itemDate < cutoff;
    }

    if (rule.after) {
      const afterDate = new Date(rule.after);
      if (Number.isNaN(afterDate.getTime())) return false;
      return itemDate >= afterDate;
    }

    if (rule.before) {
      const beforeDate = new Date(rule.before);
      if (Number.isNaN(beforeDate.getTime())) return false;
      return itemDate < beforeDate;
    }

    return true;
  }

  function evaluateGenericRule(item, rule) {
    if (!rule || !rule.field) return true;
    const value = getFieldValue(item, rule.field);

    if (Object.prototype.hasOwnProperty.call(rule, 'exists')) {
      const exists = value !== undefined && value !== null && value !== '';
      return rule.exists ? exists : !exists;
    }

    if (Object.prototype.hasOwnProperty.call(rule, 'equals')) {
      return value === rule.equals;
    }

    if (Object.prototype.hasOwnProperty.call(rule, 'not_equals')) {
      return value !== rule.not_equals;
    }

    if (Object.prototype.hasOwnProperty.call(rule, 'in')) {
      return asArray(rule.in).includes(value);
    }

    if (Object.prototype.hasOwnProperty.call(rule, 'not_in')) {
      return !asArray(rule.not_in).includes(value);
    }

    return true;
  }

  function evaluateRule(item, rule) {
    if (!rule) return true;
    if (rule.field === 'date' || rule.field === 'updated') return evaluateDateRule(item, rule);
    return evaluateGenericRule(item, rule);
  }

  function matchesFilters(item, filters) {
    if (!filters || typeof filters !== 'object') return true;

    const all = asArray(filters.all);
    if (all.length && !all.every((rule) => evaluateRule(item, rule))) return false;

    const any = asArray(filters.any);
    if (any.length && !any.some((rule) => evaluateRule(item, rule))) return false;

    const none = asArray(filters.none);
    if (none.length && none.some((rule) => evaluateRule(item, rule))) return false;

    const exclude = filters.exclude || {};
    if (pathMatches(item.path, asArray(exclude.paths))) return false;
    if (intersects(toNameArray(item.tags), asArray(exclude.tags))) return false;
    if (intersects(toNameArray(item.categories), asArray(exclude.categories))) return false;
    if (intersects(asArray(item.layout), asArray(exclude.layouts))) return false;

    const include = filters.include || {};
    const includeLayouts = asArray(include.layouts);
    if (includeLayouts.length && !includeLayouts.includes(item.layout)) return false;

    return true;
  }

  function processContent(raw, config) {
    let value = raw || '';
    if (config.document.values.content.strip_html) value = stripHtml(value);
    if (config.document.values.content.decode_entities) value = decodeEntities(value);
    if (config.document.values.content.normalize_whitespace) value = normalizeWhitespace(value);
    return value;
  }

  function buildExcerpt(item, processedContent, config, override) {
    if (override && override.excerpt) return normalizeWhitespace(override.excerpt);

    let excerpt = item.excerpt;
    if (excerpt) {
      excerpt = processContent(excerpt, config);
    } else if (config.document.values.excerpt.fallback === 'content') {
      excerpt = processedContent;
    } else {
      excerpt = '';
    }

    const maxLength = config.document.values.excerpt.max_length;
    if (typeof maxLength === 'number' && maxLength > 0 && excerpt.length > maxLength) {
      return `${excerpt.slice(0, maxLength).trim()}...`;
    }
    return excerpt;
  }

  function resolveDocumentId(item, collectionKey, config) {
    const sourceKey = config.document.id.from || 'slug';
    const rawId = item[sourceKey] || item.slug || item.path || item.source || item.title || 'untitled';
    const normalized = String(rawId)
      .replace(/\\/g, '/')
      .replace(/\.md$/i, '')
      .replace(/\.html$/i, '')
      .replace(/^\//, '')
      .replace(/\//g, '-')
      .trim();

    if (config.document.id.prefix_collection) {
      return `${collectionKey}-${normalized}`;
    }
    return normalized;
  }

  function getFieldEnabled(fieldConfig, fieldName) {
    const value = fieldConfig[fieldName];
    return boolOrObjectEnabled(value, false);
  }

  function buildBaseDocument(collected, config) {
    const item = collected.item;
    const collectionKey = collected.collection;
    const override = normalizeSearchableOverride(item.searchable);
    const content = processContent(item.content, config);
    const excerpt = buildExcerpt(item, content, config, override);
    const fields = config.document.fields;
    const doc = {};

    const fieldValues = {
      id: resolveDocumentId(item, collectionKey, config),
      collection: collectionKey,
      title: item.title || '',
      url: buildUrl(item.path),
      path: item.path || '',
      source: item.source || '',
      publishedAt: toIsoDate(item.date),
      lastUpdated: toIsoDate(item.updated),
      tags: toNameArray(item.tags),
      categories: toNameArray(item.categories),
      keywords: Array.isArray(item.keywords)
        ? item.keywords
        : typeof item.keywords === 'string'
          ? item.keywords.split(',').map((part) => part.trim()).filter(Boolean)
          : [],
      excerpt,
      content,
      boost: override.boost
    };

    Object.keys(fields).forEach((fieldName) => {
      if (!getFieldEnabled(fields, fieldName)) return;
      const fieldOverride = override.fields[fieldName];
      if (fieldOverride === false) return;
      doc[fieldName] = fieldValues[fieldName];
    });

    if (config.transform.remove_empty_fields) {
      Object.keys(doc).forEach((key) => {
        const value = doc[key];
        if (
          value === null ||
          value === undefined ||
          value === '' ||
          (Array.isArray(value) && value.length === 0)
        ) {
          delete doc[key];
        }
      });
    }

    return doc;
  }

  function shouldInclude(collected, config) {
    const item = collected.item;
    const override = normalizeSearchableOverride(item.searchable);
    if (override.enabled === false) return false;

    const collectionConfig = getCollectionConfig(config, collected.collection);
    if (!collectionConfig || !collectionConfig.enabled) return false;

    if (!isPublished(item, collected.collection)) return false;

    if (override.enabled === true) return true;

    return matchesFilters(item, collectionConfig.filters);
  }

  function sortDocuments(documents, config) {
    const field = config.transform.sort_by;
    const order = config.transform.sort_order === 'asc' ? 1 : -1;
    if (!field) return documents;

    return documents.slice().sort((a, b) => {
      const av = a[field] || '';
      const bv = b[field] || '';
      if (av === bv) return 0;
      return av > bv ? order : -order;
    });
  }

  function applyTransformers(doc, collected, context) {
    let current = doc;
    runHexoFilter(hexo, 'searchable:before_document', [current, collected, context]);

    state.transformers.forEach((transformer) => {
      const next = transformer.fn(current, collected, context);
      if (next && typeof next === 'object') current = next;
    });

    runHexoFilter(hexo, 'searchable:after_document', [current, collected, context]);
    return current;
  }

  function buildDocuments(locals) {
    const config = getConfig();
    const collected = collectItems(locals, config);
    const context = { hexo, config, locals, collected };

    let docs = collected
      .filter((entry) => shouldInclude(entry, config))
      .map((entry) => {
        const base = buildBaseDocument(entry, config);
        return applyTransformers(base, entry, context);
      })
      .filter(Boolean);

    runHexoFilter(hexo, 'searchable:before_finalize', [docs, context]);
    docs = sortDocuments(docs, config);

    state.documents = docs;
    state.documentsById = new Map(docs.map((doc) => [doc.id, doc]));
    state.lastContext = context;

    return docs;
  }

  function buildPerDocumentPath(doc, config) {
    const pattern = config.output.per_document_pattern || ':collection/:id.json';
    const relative = pattern
      .replace(':collection', String(doc.collection || 'document'))
      .replace(':id', String(doc.id || 'document').replace(/[:/\\]/g, '-'));

    const parts = [config.output.dir || 'search', relative].filter(Boolean);
    return parts.join('/').replace(/\/+/g, '/');
  }

  function generateRoutes(docs, config) {
    let routes = [];
    const pretty = !!config.output.pretty;
    const stringify = (value) => JSON.stringify(value, null, pretty ? 2 : 0);
    const mode = config.output.mode;

    if (mode === 'per-document' || mode === 'both') {
      routes = routes.concat(docs.map((doc) => ({
        path: buildPerDocumentPath(doc, config),
        data: stringify(doc)
      })));
    }

    if (mode === 'single-file' || mode === 'both' || config.output.include_index_file) {
      routes.push({
        path: config.output.file || 'search-index.json',
        data: stringify(docs)
      });
    }

    const context = { hexo, config, docs };
    runHexoFilter(hexo, 'searchable:before_routes', [routes, context]);
    runHexoFilter(hexo, 'searchable:after_routes', [routes, context]);

    return routes;
  }

  function generate(locals) {
    const config = getConfig();
    if (!config.enabled) return [];
    const docs = buildDocuments(locals);
    return generateRoutes(docs, config);
  }

  return {
    version: '1.0.0',
    registerCollector(name, fn) {
      if (!name || typeof fn !== 'function') {
        throw new Error('hexo-searchable registerCollector(name, fn) requires a name and function.');
      }
      state.collectors.push({ name, fn });
    },
    registerTransformer(name, fn) {
      if (!name || typeof fn !== 'function') {
        throw new Error('hexo-searchable registerTransformer(name, fn) requires a name and function.');
      }
      state.transformers.push({ name, fn });
    },
    getDocuments() {
      return clone(state.documents);
    },
    getDocumentById(id) {
      const doc = state.documentsById.get(id);
      return doc ? clone(doc) : null;
    },
    buildDocuments,
    generate,
    _defaults: defaults
  };
}

module.exports = {
  createSearchable
};
