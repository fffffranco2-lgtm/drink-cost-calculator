This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Pedidos Por Origem (Mesa/Balcao)

O sistema de pedidos agora suporta origem:
- `mesa_qr`: pedido feito via URL de QR com `mesa` + `token`
- `balcao`: pedido sem contexto de mesa valido

### 1. Aplicar migration

```bash
npm run supabase:db:push
```

Se pedir autenticacao da CLI, rode:

```bash
npm run supabase -- login
```

Ou exporte o token:

```bash
export SUPABASE_ACCESS_TOKEN=seu_token
```

### 2. Configurar assinatura dos QRs

No ambiente da aplicacao, defina:

```bash
TABLE_QR_SIGNING_SECRET=uma_chave_forte_e_privada
```

### 3. Gerar URLs por mesa

Gerar mesas `M01..M20` em CSV:

```bash
TABLE_QR_SIGNING_SECRET=... npm run tables:qr:urls -- --count 20 --base-url https://seu-dominio.com
```

Gerar mesas especificas:

```bash
TABLE_QR_SIGNING_SECRET=... npm run tables:qr:urls -- --tables M01,M05,M12 --base-url https://seu-dominio.com
```

Cada URL sai no formato:
- `/cardapio?mesa=M12&token=...`

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
