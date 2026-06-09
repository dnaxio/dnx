# DNX Deploy — Documentation (FR + EN)

Site bilingue basé sur [Docus](https://docus.dev) + `@nuxtjs/i18n`.

- `/fr/` → 🇫🇷 Français (défaut)
- `/en/` → 🇬🇧 English
- `/` → redirige vers `/fr/`

Un **language switcher** est automatiquement affiché dans la navbar.

## Développement

```bash
cd docs
bun install
bun run dev
```

→ `http://localhost:3000` (redirige vers `/fr`)

## Structure

```
content/
├── en/                    # 🇬🇧 English
│   ├── index.md
│   ├── 1.getting-started/
│   ├── 3.configuration/
│   ├── 4.commands/
│   └── 5.advanced/
└── fr/                    # 🇫🇷 Français
    ├── index.md
    ├── 1.getting-started/
    ├── 3.configuration/
    ├── 4.commands/
    └── 5.advanced/
```

## Build

```bash
bun run build
```
