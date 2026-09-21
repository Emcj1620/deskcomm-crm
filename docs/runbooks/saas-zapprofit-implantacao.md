# SaaS ZapProfit: auditoria e implantação incremental

## Objetivo

Separar PLATFORM/SUPER_ADMIN de TENANT/OWNER, ADMIN, MANAGER e MEMBER.
O administrador da plataforma é exclusivamente `emersonpyres@gmail.com`.
Esta documentação não equivale a uma certificação de segurança nem declara
a migração completa. Nenhum segredo deve ser registrado aqui.

## Evidências em 2026-09-21

- O código tem `platform_admins`, guard de plataforma, autenticação Supabase,
  MFA, RLS, catálogo de permissões, planos e acompanhamento de suporte.
- A criação de administradores pela API de plataforma está desabilitada:
  POST, PATCH e DELETE em `/api/v1/admin/platform-admins` retornam 405.
- O host administrativo antes permitia abrir `/app` como CRM comum; o link
  da administração também apontava para `/app` no próprio host.
- Os papéis humanos persistidos continuam `viewer`, `agent`, `manager` e
  `admin`. `ai_operator` é de máquina, não deve entrar em seletor humano.
- O provisionamento de usuário cria membership `admin`, não `owner`.
- Auditoria somente leitura de produção encontrou uma organização ativa,
  Agência Kripton, uma membership ativa e um administrador que é seu criador.
- Não houve mudança de schema ou de membership nesta etapa.

## Etapa implementada: entrada da plataforma

- Raiz do domínio administrativo abre `/admin`; a raiz do domínio dos clientes
  continua abrindo `/app`.
- `/app` no domínio administrativo exige contexto de suporte vindo do banco,
  não cookie de apresentação. Sem ele, redireciona para a administração.
- Suporte passa novamente pelo guard de plataforma (identidade, cadastro de
  administrador e MFA). Sessões expiradas/revogadas preservam o fluxo de saída
  existente, que bloqueia o acesso ao tenant.
- O link de retorno ao CRM usa `NEXT_PUBLIC_APP_URL`.
- Com `SUPERADMIN_EMAIL` configurado, MFA AAL2 é obrigatório mesmo se uma flag
  legada indicar `mfa_required=false`.
- O primeiro cadastro do autenticador abre em `/login/mfa`, sem depender do
  layout de um tenant; após confirmação, respeita apenas destinos internos.
- Removido o painel de sugestão de resposta do compositor; respostas rápidas
  e Agentes de IA permanecem. Não foram removidos registros históricos.

## Próximas etapas, ainda não concluídas

1. **Papéis reais e propriedade:** introduzir OWNER e MEMBER de forma
   compatível com chamadas antigas e agentes; mapear o proprietário existente
   por evidência confiável, não promovendo todo admin a OWNER.
2. **Proteção de propriedade:** impedir que ADMIN altere/revogue OWNER,
   impedir empresa sem proprietário e oferecer transferência explícita,
   atômica e auditada, sem deletar contatos/conversas ao revogar usuários.
3. **Pontos de criação:** ajustar signup, criação de tenant pela plataforma,
   aceite de convite, recuperação e reativação. Criador provisório da
   plataforma não pode se tornar dono permanente de empresas de clientes.
4. **Autorização completa:** sincronizar tipos, schemas, guard canônico,
   catálogo de permissões, funções SQL/RLS, UI de equipe e consumidores com
   comparações diretas dos papéis antigos. Avaliar bypass explícito de
   plataforma e suspensão nos endpoints, não somente nos layouts.
5. **Plano e cobrança:** validar limites no servidor e fluxo Asaas de ponta a
   ponta, com webhooks idempotentes. Não criar cobranças reais em testes.
6. **Testes de isolamento:** empresas A/B, usuário revogado, empresa suspensa,
   tentativa de promoção, APIs diretas e alterações concorrentes de papéis.
7. **Aceite de produção:** validar domínio dos clientes e administrativo com
   contas de cada nível, suporte com prazo/banner/saída, MFA e auditoria.

## Estratégia de migração

Antes de alterar o banco, levantar o catálogo aplicado de funções, constraints,
policies e triggers. Não presumir que o baseline local é o schema de produção.
Criar migration nova, apêndice idempotente no baseline e entrada no MANIFEST.
Testar num banco isolado e validar rollback/compatibilidade da versão anterior.
Aplicar expansão compatível antes do deploy e só converter papéis depois que
todos os consumidores estiverem preparados. Não reaplicar migrations antigas
nem incluir arquivos locais não relacionados por conveniência.

## Limites desta verificação

Os testes desta etapa cobrem roteamento, entrada do CRM pelo host admin,
exceção de suporte e guard de administrador exclusivo. Não provam isolamento
integral entre tenants nem completam os itens pendentes acima. Manter o status
de deploy e a evidência de produção separados dos testes locais.
