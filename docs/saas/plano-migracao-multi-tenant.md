# Plano incremental — SaaS multi-tenant

## Diagnóstico confirmado

O produto já possui a maior parte da fundação de tenancy: `organizations` como tenant,
`user_organizations` como vínculo N:N, quatro papéis humanos, `platform_admins` separado,
MFA, audit log append-only, suspensão de organizações, RLS e testes de isolamento. O painel
global, as sessões de suporte temporárias e a impersonação visível também já existem.

Não será criada uma segunda arquitetura paralela com tabelas `tenants` ou uma coluna
`tenant_id`. A nomenclatura canônica continuará sendo `organization_id`.

## Lacunas em relação ao SaaS solicitado

1. O painel global ainda podia ser alcançado por `/admin` no mesmo host dos clientes. A
   configuração já tinha `NEXT_PUBLIC_ADMIN_URL`, mas o runtime não a usava como fronteira.
2. Billing é apenas uma tela de placeholder. Não existem catálogo de planos, assinatura do
   tenant, concessões de features, limites nem ledger de webhooks financeiros.
3. O RBAC humano é uma hierarquia de papéis (`viewer`, `agent`, `manager`, `admin`). Ainda não
   há catálogo explícito de permissões que permita customização futura sem alterar rotas.
4. O papel `admin` hoje representa a autoridade máxima do tenant. A semântica de `OWNER`
   precisa ser adicionada sem rebatizar papéis existentes nem quebrar convites e policies.
5. O rate limiting cobre autenticação, mas não toda a superfície administrativa e de API.
6. A modelagem ainda não possui `organization_units` para filiais. Ela deve nascer opcional,
   sem obrigar registros existentes a pertencer a uma unidade.
7. Há muitos handlers com `service_role`; o filtro manual por `organization_id` possui testes,
   mas falta um gate estrutural que impeça uma rota nova de nascer sem escopo de tenant.

## Ordem de implementação

### Fase 1 — fronteiras e provas de isolamento

- usar `NEXT_PUBLIC_ADMIN_URL` como fronteira real para `/admin` e `/api/v1/admin`;
- manter JWT, `platform_admins` e MFA como autoridade, sem segurança por obscuridade;
- ampliar testes de host, tenant suspenso, usuário revogado e payload com org forjada;
- criar gate para uso de `service_role` sem filtro organizacional.

### Fase 2 — permissões e propriedade

- introduzir catálogo tipado de permissões e `requirePermission`;
- mapear os quatro papéis atuais para permissões, preservando compatibilidade;
- materializar `OWNER` como propriedade do vínculo, não como super-admin disfarçado;
- migrar primeiro equipe, configurações, integrações e billing; depois as demais rotas.

### Fase 3 — catálogo comercial sem gateway

- planos, versões de plano, features, limites e assinatura por organização;
- concessões server-side e medidores de uso;
- estados `trialing`, `active`, `past_due`, `suspended`, `canceled`;
- tela de billing lendo a decisão do servidor, nunca calculando acesso no navegador.

### Fase 4 — filiais opcionais

- `organization_units` com RLS por organização;
- vínculos opcionais entre usuários e unidades;
- nenhuma tabela operacional recebe unidade obrigatória nesta fase.

### Fase 5 — Asaas

- cliente, checkout e assinatura associados ao tenant;
- webhook assinado, idempotente e armazenado antes de processar;
- reconciliação, retentativa e auditoria;
- nenhuma chave ou payload sensível no frontend ou nos logs.

## Critério de conclusão

Cada fase só fecha com migration/baseline sincronizados, typecheck, lint, testes unitários,
testes reais de RLS/autorização e build. Mudanças de schema não são consideradas prontas sem
execução contra Postgres e uma tentativa explícita de acesso cruzado entre duas organizações.
