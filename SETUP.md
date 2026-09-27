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

## Etapa 3: identidade visual do painel e fotos de serviços

Após as migrações 001 e 002, aplique **uma vez** `supabase/migrations/202609270003_service_photos.sql` no mesmo projeto, antes de publicar esta versão. Não reaplique nem edite as migrações anteriores. A nova migração adiciona `services.photo_path` e o bucket privado `service-photos`, limitado a 2 MB e JPEG, PNG ou WebP. As políticas permitem leitura, criação e exclusão somente para administradores com MFA; uploads usam nomes únicos e não precisam de permissão de sobrescrita.

O painel reutiliza o logotipo, as fontes e as variáveis de cores do site público. Não é preciso alterar variáveis de ambiente ou o Netlify. Execute `npm ci`, `npm test` e `npm run build` antes de publicar.

### Fotografias

Crie o serviço, selecione a foto no seu card, confira a prévia e clique em **Salvar foto**. A API usa o JWT do administrador, valida tipo/tamanho declarados e confere a existência do objeto antes de salvar o caminho. O Storage também limita MIME e tamanho. A leitura usa URLs assinadas com validade de uma hora; recarregue o painel para renová-las. Não há bucket público nem uso de service role.

Trocar ou remover a foto altera sua associação ao serviço. Objetos antigos e uploads interrompidos permanecem privados no Storage; eventual limpeza deve remover apenas objetos sem referências, respeitando uploads em andamento. URLs já assinadas continuam válidas até expirar.

As fotos ainda não são exibidas no site público. Para uma futura vitrine, a estratégia é manter o bucket privado e criar um endpoint que assine somente fotos aprovadas de serviços ativos, com cache e validade curta, sem retornar dados administrativos. Esse endpoint e a aprovação para publicação não fazem parte desta etapa; não torne o bucket público para contornar essa ausência.

### Preferências de mensagens

Há uma antecedência de lembrete disponível: `reminder_minutes`, preservada em minutos (15 a 10080). As opções são exibidas em minutos, horas ou dias; valores existentes como 90 minutos continuam selecionáveis como “1 hora e 30 minutos”. A opção de 10 minutos não é oferecida porque o banco e a API exigem no mínimo 15.

`inactivity_days` permanece em dias (1 a 365), com opções de 15, 30, 45, 60 e 90 dias e entrada personalizada. A referência existente é `clients.last_visit_at`, calculada pelo trigger da migração 002 como o maior `ends_at` dos agendamentos `completed`. Cancelamentos e faltas não contam. Sem atendimento concluído, não há referência de ausência. O trigger existente cobre inserções e atualizações de status/fim; importações com exclusões ou troca de cliente precisam reconciliar esse campo em uma etapa própria.

O checkbox guarda apenas a preferência futura de notificações. Não existem worker, provedor ou envio de campanhas implementados. Confirmações de reserva não possuem antecedência configurável. Uma integração futura deve verificar o consentimento de marketing antes de qualquer reengajamento; esta versão não modifica consentimentos.

### Verificação após aplicar a migração

Com uma conta administrativa e MFA, confira as seis seções em desktop e celular; selecione, salve, troque e remova uma foto; teste uma imagem acima de 2 MB; salve lembrete e ausência, recarregue e confira os valores. Uma conta sem autorização/MFA não deve conseguir acessar os dados nem o bucket. Os testes locais validam contratos e limites; a aplicação da migração e a verificação real de RLS/Storage dependem do projeto Supabase de destino.
