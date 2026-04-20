# Refactor — Manteca (drink-cost-calculator)

Este diretório contém os arquivos refatorados respondendo aos 4 pontos priorizados no diagnóstico. **Nada foi alterado no seu código original** — copie os arquivos manualmente para seu repositório quando estiver confortável.

## Mapa de cópia

| Arquivo refatorado | Destino no seu repo |
|---|---|
| `refactor/lib/admin-csv.ts` | `lib/admin-csv.ts` *(novo)* |
| `refactor/lib/admin-seed.ts` | `lib/admin-seed.ts` *(novo)* |
| `refactor/lib/qz-core.ts` | `lib/qz-core.ts` *(novo)* |
| `refactor/lib/app-state-repo.ts` | `lib/app-state-repo.ts` *(novo)* |
| `refactor/hooks/useQzConnection.ts` | `app/admin/hooks/useQzConnection.ts` *(substitui)* |
| `refactor/hooks/useImpressaoQzConnection.ts` | `app/admin/impressao/hooks/useImpressaoQzConnection.ts` *(substitui)* |
| `refactor/hooks/usePedidosQzConnection.ts` | `app/admin/pedidos/hooks/usePedidosQzConnection.ts` *(substitui)* |
| `refactor/app/globals.css` | `app/globals.css` *(substitui)* |
| `refactor/app/admin/internal-theme.ts` | `app/admin/internal-theme.ts` *(substitui)* |
| `refactor/app/admin/page.tsx` | `app/admin/page.tsx` *(substitui)* |
| `refactor/supabase/migrations/20260420_app_state_updated_at.sql` | `supabase/migrations/20260420_app_state_updated_at.sql` *(novo)* |

Também existe `original/` com snapshot dos arquivos antes da mudança, para diff/rollback.

## Ordem recomendada de aplicação

### 1. CSS/tema (baixo risco)
- Copie `app/globals.css` e `app/admin/internal-theme.ts`.
- `page.tsx` novo já remove o `<style>{focusStyle}</style>` inline e a duplicação de `themeVars`.
- Agora existe **uma única fonte de verdade**: variáveis definidas em `:root` no `globals.css`. Tokens antigos (`--bg`, `--panel`, `--ink`, etc.) viraram aliases das novas (`--background`, `--surface`, `--foreground`), então todos os usos antigos continuam funcionando.

### 2. Unificação dos 3 hooks QZ
- Copie `lib/qz-core.ts` com o core reutilizável: `loadQz`, `configureQzSecurity`, `resolvePrinter`, `ensureQzReady`, `useQzBase`, `useQzPrinterName`.
- Substitua os 3 hooks antigos pelos novos (mesma API pública, implementação enxuta). `usePedidosQzConnection` foi de 213 linhas para 75, `useImpressaoQzConnection` de 119 para 33, `useQzConnection` de 312 para 108.
- O singleton interno (`qzLoaderPromise` + `qzSecurityReady` em `qz-core.ts`) elimina 3 loaders paralelos que antes disputavam a criação do `<script>`.

### 3. Extração de CSV + seed
- Copie `lib/admin-csv.ts` e `lib/admin-seed.ts`.
- O novo `page.tsx` importa de lá em vez de ter tudo inline. Tipagem foi apertada: os `any` do parse viraram `Record<string, unknown>` e `RawDrinkRow/RawSettingsRow` explícitos.
- O seed agora só roda depois de confirmar que **não há registro no servidor** (antes bastava o estado local estar vazio, o que podia criar duplicatas se a hidratação demorasse).

### 4. Concorrência no `app_state` (maior impacto)
- Rode a migration: `npm run supabase:db:push` depois de copiar `20260420_app_state_updated_at.sql`.
- Copie `lib/app-state-repo.ts`.
- O novo `page.tsx` usa `loadAppState` / `saveAppState` com o token `updated_at`. Quando dois admins editam simultaneamente, quem chega depois recebe `AppStateConflictError` e o app **re-hidrata automaticamente** com o estado mais recente do servidor, mostrando um aviso ("Outro admin salvou antes. Recarregamos os dados mais recentes — revise suas alterações.").
- Não há mais sobrescrita silenciosa.

## O que ficou de fora (de propósito)

- Não toquei em `DrinksTab`, `IngredientsTab`, `SettingsTab`, `ResumoTab` — eles continuam válidos.
- Não renomeei os tokens dos CSS antigos (`--bg`, `--panel`). Deixei como aliases. Se quiser migrar o admin para os nomes canônicos (`--background`, `--surface`), faço num passe separado.
- A rota `/admin/impressao` e `/admin/pedidos` ganham o QZ unificado de graça, sem mudanças no componente.

## Validação sugerida antes de commitar

1. `npm run build` — garantir que o TS compila.
2. Abrir duas abas em `/admin` e editar simultaneamente — a segunda deve recarregar automaticamente ao salvar.
3. Conectar QZ Tray e imprimir de `/admin` (settings), `/admin/impressao` e `/admin/pedidos` — as 3 rotas agora compartilham a mesma conexão.
4. Export/import CSV round-trip em `/admin/settings`.
