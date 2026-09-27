# Etapa 1: infraestrutura e autenticação

O site público continua enviando solicitações por WhatsApp. Nenhum dado do formulário público é gravado. O banco e o acesso administrativo estão preparados para as próximas etapas; não há gestão de agendamentos nem envios automáticos ainda.

## Supabase

1. Crie um projeto Supabase. No painel Auth, habilite Email/password, desabilite cadastro público e configure uma política de senha forte. Habilite MFA TOTP. Configure Site URL com o endereço HTTPS do Netlify e permita o redirect exato `https://SEU-DOMINIO/admin` (e `http://localhost:8888/admin` para desenvolvimento). Configure SMTP próprio para recuperação em produção.
2. Execute `supabase/migrations/202609270001_initial.sql` no SQL Editor (ou aplique com Supabase CLI em um projeto vinculado). Isso cria tabelas, índices, RLS, bucket privado e funções de autorização. O serviço role permanece apenas com Supabase; não é necessário incluí-lo no Netlify.
3. Em Auth → Users, crie manualmente a primeira conta por convite ou por usuário criado no painel, com senha temporária transmitida por canal seguro. Copie o UUID desse usuário. No SQL Editor, execute `insert into public.admins(user_id) values ('UUID-DO-USUARIO');`. Não há cadastro público nem promoção por interface web.
4. Faça login em `/admin`, cadastre TOTP e confirme o código. A rota só libera o estado inicial do painel após verificar usuário, membership e AAL2. Antes disso, nenhuma consulta a dados privados passa pelas políticas RLS.
5. Para recuperar acesso, use “Esqueci minha senha” e o link enviado ao e-mail cadastrado. Se perder o segundo fator, um administrador com acesso ao painel Supabase deve verificar sua identidade e remover o fator no painel Auth. Recuperar senha não contorna MFA.

## Netlify

Execute `npm install`. Defina `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_URL` e `SUPABASE_ANON_KEY` nos Environment variables do Netlify conforme `.env.example`. Use `npm run build`, publish directory `dist`. O `netlify.toml` configura `/admin` como rota SPA e ativa Netlify Functions. Para desenvolvimento do login, use `netlify dev` na porta 8888; `vite dev` não executa a função Netlify. Nunca use secret/service role key no navegador nem em variáveis `VITE_`.

## Segurança operacional

Configure no painel Auth os limites de requisições e CAPTCHA para login e recuperação, além de proteção por e-mail e MFA. A autenticação delega tentativas abusivas ao Supabase; a aplicação não implementa bloqueio distribuído próprio. A função valida o JWT com `getUser`, confirma vínculo administrativo e AAL2; as políticas RLS aplicam as mesmas exigências nas tabelas privadas. O bucket de fotos é privado: eventual exibição pública deve passar por entrega controlada/versões públicas aprovadas na etapa futura. O frontend pode ser baixado por qualquer pessoa; somente operações de dados estão protegidas.

## Escopo pendente

A próxima etapa deve implementar operações de agendamento no servidor, consistência transacional de duração/preço, prevenção de choques de agenda, trilha de auditoria automática, consentimento do cliente e notificações. As restrições desta migração não substituem essas regras de negócio. Não considere o formulário público atual um agendamento persistido.

## Etapa 2: painel administrativo

Após a migração inicial, aplique `supabase/migrations/202609270002_admin_panel.sql` no mesmo projeto e publique esta versão no Netlify. A função `admin-api` verifica sessão, vínculo administrativo e MFA em cada operação; os dados usam o JWT do administrador e RLS. O painel oferece agenda, barbeiros, serviços, fotos privadas, horários, bloqueios, clientes e preferências de notificações. A agenda só terá registros quando os agendamentos forem criados numa etapa posterior ou importados. Nenhuma mensagem é enviada automaticamente.

Uma alteração de expediente com atendimentos futuros naquele dia é recusada, assim como bloqueios sobre atendimentos ativos. As fotos usam URLs temporárias de leitura e upload assinado no bucket privado.
