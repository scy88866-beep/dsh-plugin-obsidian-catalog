# scy88866-beep DSH plugin market

A self-hosted [plugin market index format 1](https://github.com/deepseek-ai/deepseek-harness) for DeepSeek Harness (DSH) plugins published by [scy88866-beep](https://github.com/scy88866-beep).

## Index URL

```
https://raw.githubusercontent.com/scy88866-beep/dsh-plugin-obsidian-catalog/main/market/index.json
```

## Add it to DSH

Add that URL as an index source in **Plugins → Discover**, or through the `plugin_market` tool:

```json
{ "action": "add_index", "url": "https://raw.githubusercontent.com/scy88866-beep/dsh-plugin-obsidian-catalog/main/market/index.json" }
```

Every version here is pinned to a full commit SHA, so installing from this market always fetches exactly the reviewed source.

## Plugins

| Plugin | Version | Category |
| --- | --- | --- |
| `dsh-plugin-obsidian-catalog` — Obsidian vault table of contents as a conversation view | 1.0.0 | Data & Knowledge |
