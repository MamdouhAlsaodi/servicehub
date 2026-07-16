# ServiceHub — Documentação em Português (Brasil)

> Um marketplace de serviços com múltiplos fornecedores: o cliente encontra, agenda e avalia; o fornecedor organiza serviços e disponibilidade; a administração acompanha a operação.

**Idiomas:** [English](README.md) · [العربية](README.ar.md)

> **Status: MVP de portfólio após hardening — 16 de julho de 2026.** A verificação local mais recente aprovou **242/242 testes da API em 17 suites**, após reforço de autorização e fluxos financeiros. Isso não significa publicação pública nem operação comercial de pagamentos reais.

## Problema e proposta

Agendamentos locais normalmente ficam espalhados entre mensagens, chamadas e planilhas. O ServiceHub transforma essa jornada em um fluxo único e rastreável:

```text
Descobrir fornecedor → escolher serviço e horário → reservar com segurança → pagar → receber atualizações → avaliar
```

O modelo atende salões, restaurantes, consultores, manutenção e outros negócios que trabalham com horário marcado.

## Funcionalidades por perfil

| Perfil | Escopo implementado |
|---|---|
| **Cliente** | Busca e filtros, perfil público do fornecedor, horários disponíveis, reserva temporária, checkout, cancelamento, avaliação, mensagens e notificações |
| **Fornecedor** | Serviços, disponibilidade semanal e exceções, visibilidade de reservas e telas operacionais de dashboard |
| **Administração** | Aprovação/suspensão de fornecedores, indicadores, relatórios, disputas, categorias e camadas de exportação/payout |

## Destaques técnicos

- **Proteção contra dupla reserva no banco:** uma constraint PostgreSQL `EXCLUDE USING gist` impede sobreposição de reservas ativas do mesmo fornecedor.
- **Pagamentos desacoplados:** Mock para desenvolvimento/demonstração e uma fronteira de provider para Stripe quando configurado corretamente.
- **Segurança de aplicação:** JWT e CORS explícitos em produção, roles, ownership/IDOR checks, bcrypt, revogação de refresh token, throttling por rota, validação e cobertura de CSRF.
- **Decisão financeira auditável:** Admin resolve a fila de reservas canceladas com `FULL_REFUND`, `PARTIAL_REFUND` ou `REJECT`, incluindo motivo, registro durável e proteção contra decisão duplicada.
- **Regras de domínio:** hold de pagamento de 5 minutos, política de cancelamento, webhooks idempotentes e uma avaliação por reserva elegível.

## Arquitetura

```text
Usuários → Next.js Web → NestJS REST API → Prisma → PostgreSQL
                                      └→ Mock (dev) / Stripe (produção configurada)
```

| Camada | Tecnologia | Responsabilidade |
|---|---|---|
| Web | Next.js 14 + TypeScript + Tailwind | Jornadas de cliente, fornecedor e administrador |
| API | NestJS 11 | Auth, catálogo, disponibilidade, reservas, pagamentos, avaliações, mensagens e admin |
| Dados | PostgreSQL 16 + Prisma 5 | Dados transacionais, migrations e integridade |
| Qualidade | Jest + ts-jest | Testes de serviço, segurança e integração |

## Execução local

### API

```bash
cd apps/api
cp .env.example .env
npm install
npx prisma migrate deploy
npx prisma generate
npm run build
npm start
```

### Web

```bash
cd apps/web
npm install
npm run build
npm start
```

Para desenvolvimento: `npm run start:dev` em `apps/api` e `npm run dev` em `apps/web`.

## Verificação registrada

Em **16 de julho de 2026**, foi executado:

```bash
cd apps/api
npx jest --runInBand
```

Resultado: **17 suites aprovadas e 242 testes aprovados**.

O arquivo [`docs/qa/acceptance-checklist.md`](docs/qa/acceptance-checklist.md) separa evidência automatizada das validações de navegador e produção que ainda precisam ser executadas.

## Limites da demonstração

- `PAYMENTS_PROVIDER=mock` é somente para desenvolvimento e demo.
- Stripe real exige secrets, webhook verificado, configuração de deploy e teste E2E.
- **Google (Demo)** é uma simulação local; não chama o Google e não é OAuth real.
- O projeto não é anunciado como aplicação pública ou pronta para cobrar clientes reais.

## Materiais de apresentação

- [Apresentação editável em inglês](docs/ServiceHub-Presentation-EN.pptx)
- [Apresentação editável em árabe](docs/ServiceHub-Presentation-AR.pptx)
- [Apresentação editável em português (Brasil)](docs/ServiceHub-Apresentacao-PT-BR.pptx)
- [Gerador das apresentações](docs/generate_servicehub_multilingual_presentations.py)
- [Relatório de conformidade do PRD](docs/PRD-COMPLIANCE-REPORT-2026-07-14.md)

## Licença

Proprietary © 2026. Artefato de portfólio e estudo; reutilização requer autorização.
