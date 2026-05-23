# UI components

shadcn/ui components live here once you run e.g. `pnpm dlx shadcn@latest add button`.

shadcn's CLI installs into the path you configure in `components.json`.
Point it at this folder so all apps can share.

Each component is also re-exported from `../src/index.ts` so consumers
can `import { Button } from '@school-manager/ui'`.
