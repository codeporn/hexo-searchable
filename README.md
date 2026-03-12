# hexo-searchable
[![npm version](https://badge.fury.io/js/hexo-searchable.svg)](https://badge.fury.io/js/hexo-searchable)

Generate structured JSON search documents from Hexo posts and pages for any search backend.

## Features

- Single file, per-document, or both output modes
- Configurable output paths and file names
- Configurable default fields with sensible defaults
- Per-document front matter overrides via `searchable.enabled`
- Separate `date` and `updated` filtering
- Combined filter groups with `any`, `all`, and `none`
- Plugin API for collectors and transformers
- Lifecycle hook names for other plugins via Hexo filters

## Install via npm

``` bash
$ npm install hexo-searchable
```

## Install locally for testing

Copy the folder into your Hexo project, then reference it as a local package in `package.json`.

```json
{
  "dependencies": {
    "hexo-searchable": "file:./plugins/hexo-searchable"
  }
}
```

Then run:

```bash
npm install
hexo clean
hexo generate
```

## Example config

```yml
searchable:
  enabled: true
  collections:
    posts:
      enabled: true
      filters:
        any:
          - field: date
            within_last_days: 10
          - field: updated
            within_last_days: 30
    pages:
      enabled: true
  output:
    mode: both
    dir: search
    file: search-index.json
    pretty: true
    include_index_file: true
    per_document_pattern: ":collection/:id.json"
  document:
    id:
      from: slug
      prefix_collection: true
    fields:
      id: true
      collection: true
      title: true
      url: true
      publishedAt: true
      lastUpdated: true
      tags: true
      categories: true
      keywords: true
      excerpt: true
      content: true
  transform:
    remove_empty_fields: true
    sort_by: publishedAt
    sort_order: desc
```

## Front matter overrides

```yml
searchable:
  enabled: false
```

```yml
searchable:
  enabled: true
  excerpt: "Custom search excerpt"
  boost: 2
  fields:
    content: false
```

## Plugin API

### registerCollector

```js
hexo.searchable.registerCollector('my-collector', ({ hexo, config, locals, items }) => {
  return [];
});
```

Each collector should return entries shaped like:

```js
{
  collection: 'custom',
  item: {
    title: 'My title',
    path: 'custom/example/',
    content: '<p>Example</p>',
    date: new Date(),
    updated: new Date(),
    searchable: { enabled: true }
  }
}
```

### registerTransformer

```js
hexo.searchable.registerTransformer('reading-time', (doc, collected, context) => {
  if (!doc.content) return doc;
  const words = doc.content.split(/\s+/).filter(Boolean).length;
  doc.readingTime = Math.max(1, Math.ceil(words / 200));
  return doc;
});
```

### Read API

```js
const docs = hexo.searchable.getDocuments();
const doc = hexo.searchable.getDocumentById('post:my-post');
```

## Lifecycle hooks

These are available through Hexo's filter system:

- `searchable:collect`
- `searchable:before_document`
- `searchable:after_document`
- `searchable:before_finalize`
- `searchable:before_routes`
- `searchable:after_routes`

## Notes

- Posts marked with `published: false` or `draft: true` are excluded.
- Pages are always treated as publishable unless excluded by config or front matter.
- `searchable.enabled: true` overrides collection filters.
- `searchable.enabled: false` always excludes the document.
