---
impacto: nada_mudou
secao: corrigido
titulo: Separa a entrada administrativa do CRM no domínio exclusivo
---

No domínio exclusivo da plataforma, a raiz abre a administração. As telas do
CRM exigem acompanhamento administrativo explícito validado no servidor;
fora dele, voltam à administração. O link de retorno ao CRM usa o domínio
configurado dos clientes. O administrador exclusivo exige MFA de sessão mesmo
se a flag antiga do banco estiver desligada. Instalações com domínio
compartilhado continuam funcionando. Esta mudança não migra os papéis dos
membros de empresas.

Quem ainda não cadastrou autenticador pode fazê-lo na própria tela de MFA,
sem ciclo entre CRM, administração e login.
