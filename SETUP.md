# Configuração GEO'ROCHA BARBEARIA

**Versão atual:** agendamento público persistido, com múltiplos serviços e disponibilidade individual. Aplique as migrações em ordem até **006**. A seção **Etapa 5 — agendamento real e grade individual**, no fim deste documento, descreve a ativação atual e substitui as limitações do fluxo público das etapas anteriores. Nenhuma migração remota é executada automaticamente.

## Etapa 1: infraestrutura e autenticação (histórico)

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

## Etapa 4: exclusão lógica de barbeiros e serviços

1. Aplique `supabase/migrations/202609270004_catalog_soft_delete.sql` uma vez, após 001, 002 e 003. A migração não apaga dados e mantém as políticas RLS existentes.
2. Publique esta versão. Em **Barbeiros → Editar → Vínculo com o agendamento público**, associe explicitamente o cadastro correto a **Geovane** ou **Daniel**, os contatos já definidos em `src/data/barbeiros.js`. Cada contato aceita um único vínculo, inclusive entre cadastros inativos. Não há associação automática por nome. Os telefones públicos existentes continuam sendo usados; configure seus números reais se ainda estiverem com os placeholders originais.
3. Confira os contatos ativos no formulário público. Sem vínculo, sem Supabase configurado ou com falha na consulta, nenhum barbeiro é oferecido: não existe fallback para uma lista que possa conter excluídos. Para evitar interrupção numa publicação, preencha `public_booking_key` com `geovane` ou `daniel` nos UUIDs corretos pelo painel Supabase após a migração e antes do deploy; depois o próprio painel administrativo pode gerenciar esse vínculo.

**Excluir barbeiro** e **Excluir serviço** gravam somente `active=false`. Não existe distinção entre um cadastro previamente desativado e um excluído logicamente. O filtro **Mostrar inativos** permite consultar os cadastros e reativá-los. Agendamentos, snapshots de nome/preço/duração, vínculos e caminhos das fotos são preservados; nenhuma exclusão de objetos do Storage é feita.

A confirmação mostra nome e, para serviços, preço. A prévia vem do servidor e considera todos os agendamentos `pending`/`confirmed` com `ends_at > now()`, incluindo os em andamento. Havendo vínculos, o botão de exclusão fica bloqueado e **Abrir agendamentos relacionados** mostra a lista para revisão. O administrador pode cancelar individualmente com confirmação, ou concluir somente atendimentos realmente realizados, e então solicitar a exclusão novamente. Remarcar apenas a data não elimina o vínculo. Não há cancelamentos em lote ou reatribuições automáticas.

As ações `delete_barber`, `delete_service` e `deletion_preview` reutilizam a função Netlify autenticada. As RPCs exigem administrador com MFA e usam RLS. Triggers aplicam o bloqueio inclusive a atualizações diretas de `active`; outros triggers impedem reservas futuras com barbeiros/serviços inativos e reativação de agendamentos que os referenciem. Um advisory lock transacional compartilhado serializa as escritas nas quatro tabelas envolvidas, antes dos locks de linha, para evitar a corrida entre exclusão e criação de reserva no isolamento padrão READ COMMITTED do Supabase. Esse lock pode aumentar a espera entre gravações simultâneas; mantenha transações curtas.

O site público teve apenas sua fonte de disponibilidade conectada ao banco, sem redesenho. A RPC pública `public_booking_barbers()` retorna exclusivamente as chaves dos contatos ativos e vinculados, sem nomes de clientes, agenda, fotos privadas ou configurações. A lista é atualizada ao carregar, ao voltar à janela e a cada 30 segundos; o contato é consultado novamente antes de abrir o WhatsApp na mesma aba. O fluxo público continua sendo uma solicitação via WhatsApp, sem reserva persistida ou confirmação automática. Uma mensagem já aberta no WhatsApp não pode ser revogada pela exclusão posterior. O formulário atual não oferece seleção de serviços; no painel, serviços inativos somem dos serviços ativos dos barbeiros, e o banco impede usá-los em novas reservas.

### Testes

`npm test` inclui testes da API e testes de PostgreSQL com PGlite (dependência apenas de desenvolvimento). Os testes aplicam as quatro migrações em banco descartável em memória, com schemas Auth/Storage simulados, e verificam exclusão lógica, bloqueios, snapshots históricos, fotos, RLS, MFA e a projeção pública mínima. Não acessam o Supabase real. A concorrência entre conexões e a operação real de Auth/Storage devem ser validadas no ambiente Supabase antes da publicação.

## Etapa 5 — agendamento real e grade individual

### Migrações e ativação

Após 001–004, aplique **005_individual_schedules** e **006_public_booking**, nessa ordem, usando os arquivos completos de `supabase/migrations`. Nenhum horário existente é substituído. As novas colunas têm defaults: grade de 30 minutos, preparação de 0 minutos, antecedência de 60 minutos, horizonte de 60 dias e agendamento online desabilitado. O default da grade é uma preferência inicial individual, não uma grade global. Alterar esses campos não muda reservas existentes.

Não há novas variáveis de ambiente: a função `booking.mjs` usa `SUPABASE_URL` e `SUPABASE_ANON_KEY` existentes. Não é necessária chave service_role. Desenvolvimento completo requer `netlify dev`; Vite isolado não executa as funções de agendamento.

No painel, crie ou edite um barbeiro. Configure **Intervalo da grade de horários** (5, 10, 15, 20, 30, 45 ou 60 minutos), preparação, antecedência e horizonte. Salve o cadastro e configure o expediente na seção exibida abaixo da edição. A grade começa na abertura de cada período e controla somente os possíveis inícios. Pausas eliminam os inícios incompatíveis sem alterar a duração. A preparação ocupa tempo após o atendimento, inclusive antes de uma pausa ou fechamento, mas não entra na duração/preço apresentados ao cliente. Seu valor fica registrado na reserva; alterações posteriores não mudam reservas anteriores.

### Geovane, Daniel e novos profissionais

- **Geovane:** mantenha ou preencha o vínculo público `geovane` no cadastro correto. Clique em **Aplicar horários iniciais de Geovane** e confirme. O modelo aplica segunda a sábado, **09:00–12:00 e 14:00–20:00**, e domingo fechado. Ele recusa qualquer expediente/exceção já existente. Se houver horários cadastrados, revise cada dia manualmente; agendamentos futuros vinculados devem ser resolvidos antes da mudança de jornada.
- **Daniel:** mantenha o cadastro, com online desabilitado até configurar sua jornada real. Nenhuma migração define horários para ele.
- **Novos barbeiros:** não há lista fixa para a seleção pública. Ao habilitar **Receber agendamentos online**, um vínculo público é gerado quando estiver vazio. Cadastros ativos, habilitados, vinculados e com horários aparecem automaticamente. Associe serviços ativos para permitir avançar no fluxo. Os identificadores antigos `geovane`/`daniel` continuam válidos.

O expediente aceita vários períodos e várias pausas por período. Para fechar um dia, salve sem períodos. Em **Configurar uma data específica**, o expediente daquela data substitui o semanal: salve sem períodos para folga ou adicione períodos excepcionais. A remoção da exceção restaura a jornada semanal. Férias e bloqueios continuam disponíveis separadamente. Mudanças de jornada com reservas futuras no dia afetado são recusadas; mudanças de grade são permitidas e preservam as reservas.

### Reserva, privacidade e fotos

O fluxo público é barbeiro → serviços → data → horário → dados e confirmação. Somente após confirmar são criados cliente (se ainda não existir), agendamento `pending` e snapshots dos serviços, em uma transação. Preços e durações são consultados novamente no banco. Duplicatas de clique/reenvio usam uma chave idempotente; falhas não deixam registros parciais. O nome/consentimento de marketing de clientes existentes não é sobrescrito por solicitações anônimas com o mesmo telefone. O consentimento solicitado vale apenas para tratar a reserva, sem marketing.

A disponibilidade considera períodos, pausas, exceções por data, bloqueios, pendentes/confirmados, preparação, antecedência, horizonte e horário atual em **America/Fortaleza**. O mesmo cálculo valida a confirmação dentro do lock transacional existente, junto à constraint de sobreposição. As APIs públicas não retornam clientes, reservas de terceiros ou expediente interno: retornam catálogo publicado e horários reserváveis.

Habilitar o agendamento online publica as fotos atuais do barbeiro e dos serviços ativos oferecidos. Os buckets continuam privados: a política de leitura permite apenas objetos associados ao catálogo habilitado e com expediente. O endpoint do catálogo emite URLs assinadas por **10 minutos**. Fotos desativadas saem da projeção; URLs já assinadas podem durar até expirar. Nenhum objeto é apagado.

O painel busca novos registros a cada 30 segundos nas seções Visão geral, Agendamentos e Clientes, sem interromper a edição de expediente. O bootstrap consulta as páginas de dados para não omitir reservas após 2.000 registros. Cancelamentos liberam horários; remarcações passam pela validação de jornada, intervalos e conflitos.

### Limites e proteção contra abuso

Há limite transacional de **3 reservas por telefone por hora** e **120 reservas globais por 10 minutos**, inclusive nas chamadas diretas à RPC. Reenvio idempotente não consome nova reserva. A função Netlify configura **60 requisições por minuto por IP/domínio**, limita o corpo a 64 KB e rejeita o campo oculto antispam preenchido. Confira a aceitação da regra de rate limit no log do deploy; uma regra inválida pode não interromper a publicação ([documentação Netlify](https://docs.netlify.com/manage/security/secure-access-to-sites/rate-limiting/)). As quotas de banco permanecem independentes da regra Netlify.

O telefone é declarado pelo cliente, sem verificação SMS/OTP ou CAPTCHA. Os limites reduzem abuso, mas não comprovam identidade. Consultas diretas ao Supabase não passam pelo limite de IP da Netlify; a criação continua sujeita às quotas e validações do banco. O envio de mensagens e lembretes não foi implementado. Após salvar, o link manual de WhatsApp aparece somente quando houver um telefone válido configurado para o contato legado ou o contato geral.

### Como testar um agendamento completo

1. Aplique as migrações em um projeto de testes e execute `netlify dev` com as variáveis existentes.
2. Com administrador e MFA, configure um barbeiro ativo, uma jornada real, grade de 30 minutos e preparação de 0. Vincule serviços de 30 e 20 minutos e habilite online.
3. No site, escolha o profissional e os dois serviços. Confira soma de preço e duração de **50 minutos**, escolha uma data aberta e um início disponível.
4. Informe nome completo, telefone com DDD e consentimento de contato. Confirme. Confira o protocolo e o registro pendente no painel.
5. Tente o mesmo início em outra sessão. Somente uma reserva deve ser aceita; horários sobrepostos devem ser recusados e atualizados. Cancele no painel e confira a liberação.
6. Mude somente a grade para 15 minutos: os novos inícios mudam, mas a reserva criada mantém seus horários. Teste almoço, fechamento, bloqueio, exceção por data e barbeiro sem jornada.

`npm test` aplica todas as seis migrações em PGlite e também inicia um PostgreSQL 17 temporário, limitado a `127.0.0.1`, para testar concorrência entre conexões independentes. O teste aguarda a segunda conexão bloquear no advisory lock antes de confirmar a primeira transação. Cobre conflitos entre reservas (inclusive somente pela preparação), bloqueios, alterações diretas no expediente e remarcações administrativas, além da idempotência simultânea. O cluster temporário é encerrado e removido ao terminar. Os binários vêm da dependência de desenvolvimento `embedded-postgres`; sua instalação exige os scripts de instalação do npm. Nenhum teste acessa o Supabase remoto.

### Revisão de segurança das migrações 005 e 006

As correções estão nos próprios arquivos 005/006, ainda não aplicados. Não reaplique esses arquivos se já estiverem registrados no banco: nesse caso será necessária uma migração incremental com as diferenças.

- A duração do atendimento continua sendo a soma dos serviços, sem incluir preparação. A ocupação usa `[início, fim + preparação)`, tanto na disponibilidade quanto na confirmação pública e na validação administrativa. A grade determina somente os inícios.
- A preparação é capturada no banco ao criar ou remarcar (alterar início ou barbeiro) uma reserva. Alterar a preferência do barbeiro ou apenas o status não modifica a preparação de reservas existentes. Uma remarcação preserva duração e preço registrados; tentativa de alterá-los é rejeitada. Não há ação para trocar os serviços de uma reserva existente.
- Escritas de catálogo, reservas, serviços de reservas, vínculos, expediente, pausas, exceções e bloqueios compartilham o mesmo lock transacional. Alterações diretas no expediente também rejeitam dias com reservas pendentes/confirmadas futuras ou em andamento. Transações de escrita exigem `READ COMMITTED`, para evitar decisões baseadas em snapshots antigos. O lock é global: mantenha transações curtas.
- O navegador gera UUIDv4 com `crypto.randomUUID()` para cada nova solicitação; repetições da mesma solicitação reutilizam o identificador. API e RPC validam a versão. A versão não comprova a entropia de identificadores enviados por clientes externos. Não existe consulta pública de comprovante somente pelo UUID: a repetição exige o mesmo conteúdo completo, comparado sem hash e com o instante normalizado. O comprovante não contém nome, telefone ou ID do cliente. `booking_requests` permite leitura apenas ao administrador com MFA; inserções são internas à RPC.
- As permissões removem também concessões diretas de `EXECUTE` vindas de privilégios padrão. Funções internas não são executáveis por `anon`/`authenticated`; RPCs administrativas mantêm autorização e MFA. `TRUNCATE`, `REFERENCES` e criação de triggers são revogados das tabelas administrativas para as funções de acesso da aplicação. RLS permanece habilitada. As fotos continuam privadas, com leitura restrita às referências publicadas.

**Conferência do destino antes de aplicar:** execute manualmente `supabase/checks/preflight_005_006.sql` no SQL Editor. Ele apenas consulta metadados. Compare colunas, constraints, triggers, funções, políticas, extensões e permissões com 001–004; confirme que 005/006 ainda não foram aplicadas no histórico de migrações. `barbers_public_booking_key_check`, as funções substituídas e o trigger `validate_appointment_schedule` precisam corresponder às versões locais. `anon`/`authenticated` não podem ter `BYPASSRLS`, superusuário, propriedade das tabelas ou herança de funções privilegiadas. Divergências precisam ser resolvidas antes de aplicar. Os testes validam o esquema reconstruído das migrações; o esquema e os dados remotos não foram consultados nesta revisão.

A inspeção visual em dispositivos reais e a conferência de RLS/Storage com sessões reais do Supabase permanecem na validação da implantação.

## Diagnóstico: barbeiro ativo não aparece no site

O frontend atual usa usePublicBarbers → função Netlify booking (GET) → public_booking_catalog. A RPC public_booking_barbers permanece como projeção das mesmas chaves; o helper antigo publicCatalog.js não é usado pelo App atual.

Além de ativo, online habilitado e vínculo preenchido, o catálogo exige pelo menos um período semanal ou uma exceção de hoje/futura com períodos. Abra Barbeiros → Configurar expediente e preferências, adicione períodos e clique em Salvar expediente. Sem serviços ativos vinculados, o profissional pode aparecer, mas não é possível reservar; selecione os serviços oferecidos no cartão. O diagnóstico do painel usa os dados salvos e não garante horários livres numa data específica.

Se houver erro de consulta, confira a resposta de GET /.netlify/functions/booking no navegador. Uma lista vazia válida é {"data":[]}; erro HTTP, HTML ou resposta inválida não são ausência de profissionais. Confira se as migrações até 006 estão aplicadas, se o deploy inclui a função booking e se painel e função apontam para o mesmo projeto Supabase. Use a consulta de preflight para conferir permissões; não libere SELECT anônimo nas tabelas administrativas. Vite sozinho não executa funções Netlify. Nenhuma migração adicional é necessária para as correções de interface desta etapa.

## Etapa 7: cadastro completo de barbeiros

Aplique manualmente `supabase/migrations/202609270007_barber_editor.sql` depois de 001–006, antes de publicar esta versão do painel. A migração cria `barber_editor_snapshot(uuid)` e `save_barber_profile(uuid,jsonb,jsonb)`, ambas SECURITY INVOKER, com execução restrita a authenticated e validação administrativa/MFA. Não altera tabelas, políticas RLS, catálogo público ou registros existentes. Não foi executada remotamente.

A seção Barbeiros tem estados exclusivos: listagem, novo cadastro e edição. Abrir o formulário não persiste registros. Os serviços, períodos semanais, pausas, exceções, preferências e bloqueios são preparados localmente. Copiar dias substitui os destinos selecionados após confirmação quando necessário; cada cópia permanece independente. O único salvamento principal confirma tudo numa transação com o lock da agenda. Dias e exceções sem mudanças são preservados, inclusive seus IDs. Alterações incompatíveis com reservas existentes continuam bloqueadas e revertem toda a operação.

A edição carrega os dados reais por RPC e envia o snapshot original como controle de concorrência. Se outro administrador alterar o cadastro, o salvamento é recusado com orientação para reabrir a versão atual. Datas do snapshot são normalizadas em UTC; os horários do atendimento continuam interpretados em America/Fortaleza. Falhas ou repetição do cadastro com o mesmo UUID não criam profissionais duplicados. Uma resposta de rede perdida após confirmação pode exigir voltar à lista e recarregar.

Para habilitar online, o salvamento exige pelo menos um serviço ativo vinculado e expediente semanal ou exceção atual/futura com períodos. É permitido salvar um cadastro offline sem agenda; ele não será publicado. Vínculos preexistentes com serviços inativos podem ser mantidos para consulta, sem oferecê-los publicamente. O campo ativo não é alterado por esse formulário; desativação/reativação são ações separadas com confirmação.

A fotografia é enviada, somente ao salvar, ao bucket privado barber-photos usando URL assinada. A RPC verifica caminho, existência e metadados do objeto (JPEG/PNG/WebP, até 2 MB) antes de vincular. Trocar/remover uma foto remove apenas a referência: objetos antigos não são apagados. Se a transação falhar depois do upload, o arquivo permanece privado e pode ser reutilizado numa nova tentativa no mesmo formulário. Arquivos sem referência podem requerer limpeza administrativa posterior, sempre conferindo referências; não existe limpeza automática nesta versão.

Testes incluem o componente React (estados exclusivos, carregamento, descarte e submissão única), cadastro/edição transacionais, cópia independente dos dias, autorização, fotos, publicação, preservação de reservas e concorrência entre conexões PostgreSQL. A validação visual final e o upload via Storage no ambiente Supabase real devem ser conferidos após aplicar 007.

## Etapa 8: exclusão definitiva de barbeiros

Antes de implantar, confira o destino com `supabase/checks/preflight_008.sql` (somente leitura). A inspeção desta implementação usou o esquema das migrações locais e bancos locais de teste, não o banco remoto. Aplique manualmente `supabase/migrations/202609290008_barber_permanent_delete.sql` após 001–007, antes do deploy desta versão. Não execute novamente migrações anteriores.

Os cartões passam a oferecer Editar, Desativar/Ativar e Excluir. A confirmação de exclusão definitiva exibe o nome, explica a irreversibilidade e exige digitar o nome exato. A desativação existente continua gravando active=false, sujeita às proteções de agendamentos futuros, e pode ser revertida. A exclusão definitiva permite históricos concluídos ou cancelados cujo horário já terminou. Bloqueia pendentes, confirmados, atendimentos futuros/em andamento e outros status (inclusive não compareceu, por precaução até revisão administrativa). A alternativa de desativação fica disponível na confirmação.

A RPC permanently_delete_barber exige administrador com MFA e READ COMMITTED. Ela usa o mesmo advisory lock das reservas e das alterações administrativas, confere novamente o nome e a ausência de atendimentos que ainda bloqueiam a operação, consulta as FKs efetivas e recusa referências adicionais não previstas. Remove explicitamente pausas, expediente, vínculos, exceções e bloqueios pertencentes ao barbeiro, e só então o cadastro. Não exclui clientes, serviços, outros barbeiros, agendamentos ou auditoria. Novas FKs, inclusive cascatas, exigem revisão antes da exclusão. Exclusões diretas de barbers ficam bloqueadas fora da operação protegida.

Fotos: arquivos são removidos exclusivamente pela API do Storage, nunca por DELETE em storage.objects. Consulte a orientação oficial: https://supabase.com/docs/guides/storage/schema/design . A transação grava barber_deletions (identificador e nome do barbeiro, UUID e nome disponível do administrador, caminho anterior e data/hora) e barber_photo_cleanup, ambas com RLS e leitura apenas para administrador com MFA. Esses registros de controle e a auditoria permanecem após a exclusão; não são um cadastro de barbeiro ativo ou reativável. Fotografias compartilhadas com outro barbeiro são preservadas. Caminhos reservados para remoção não podem ser associados novamente. O identificador interno excluído não pode ser reutilizado.

Banco e Storage não compartilham uma transação. Após excluir, a API tenta remover até 100 fotos pendentes e só marca como concluídos os objetos ausentes no Storage. Em caso de falha, a exclusão do cadastro continua concluída, a pendência fica registrada e o painel oferece Tentar remover fotos novamente. A limpeza também é retomada ao carregar/atualizar o painel; não há tarefa agendada nem service_role. Para grandes quantidades, podem ser necessárias várias tentativas/lotes. Os controles preservam os prefixos excluídos: uploads tardios por URLs assinadas emitidas anteriormente são identificados na próxima verificação e nunca podem ser vinculados/publicados pelo cadastro excluído. Objetos não utilizados não ficam sem rastreamento, mas a remoção física pendente requer uma nova execução se a API falhar ou um upload chegar depois da verificação.

Validação: testes de exclusão permitida, histórico de todos os status, referências inesperadas, autorização/MFA, confirmação pelo nome, fotos compartilhadas, falha/repetição do Storage, uploads tardios, estados da interface e concorrência real (reserva primeiro e exclusão primeiro). Nenhum SQL remoto é executado pelos testes. Valide o acesso à API real do Storage após aplicar a migração.

### Preservação do histórico na revisão da 008

A 008 ainda não aplicada foi revisada, sem criar 009. Requer PostgreSQL 15 ou superior. A aplicação ocorre em uma transação e bloqueia temporariamente escritas em barbeiros/agendamentos. A FK de appointments.barber_id passa a referenciar barber_history_ids, um registro mínimo de identidades permanentes, com DELETE RESTRICT. Os IDs originais, NOT NULL e todas as linhas de agendamentos permanecem intactos. O cadastro operacional é removido; a identidade técnica não pode ser reutilizada. Agendamentos e serviços históricos de barbeiros excluídos ficam protegidos contra alterações e exclusões.

O servidor captura auth.uid(), o nome disponível em auth.users.raw_user_meta_data.full_name e clock_timestamp(). O nome é um rótulo cadastral; o UUID verificável sempre aparece na interface e permanece mesmo se a conta administrativa for removida. Sem nome disponível, a mensagem usa UUID, sem inventar identificação. A agenda, os filtros e o histórico de clientes mantêm o barbeiro excluído e mostram a atribuição da exclusão e a data/hora em America/Fortaleza.

A view appointment_history usa security_invoker e as políticas RLS existentes. Relatórios externos devem usar essa view ou LEFT JOIN com barber_deletions; um INNER JOIN apenas com barbers ocultaria históricos excluídos. O preflight inventaria views, referências, colunas, triggers, funções e permissões relevantes, mas não identifica consultas mantidas em ferramentas externas. Conferir esses relatórios e o esquema real antes de aplicar: nenhum banco remoto foi consultado ou alterado nesta revisão.

## Etapa 9: lembretes transacionais de agendamento

### Instalação

Execute manualmente o inventário somente leitura supabase/checks/preflight_009.sql e compare com 001–008 já aplicadas. Depois aplique somente supabase/migrations/202609300009_appointment_reminders.sql, antes de publicar o painel atualizado. Nenhuma migração anterior foi alterada e nenhum SQL remoto foi executado nesta etapa. A 009 cria reminder_settings e appointment_reminders, adiciona reminder_revision aos agendamentos, notification_phone/notification_consent aos barbeiros e whatsapp_reminder_consent aos clientes. Ambos os tipos começam desativados; consentimentos começam falsos. Nenhum histórico é apagado.

### Administração e consentimento

Abra Lembretes no painel: cliente e barbeiro têm ativação e antecedência independentes, em minutos/horas/dias (15 minutos a 7 dias; minutos inteiros no banco). Os controles antigos em Configurações permanecem armazenados, mas não controlam esta fila. Não existem campanhas, ausência automática, chatbot ou marketing nesta etapa.

Em Destinatários e consentimento, selecione o titular. O cliente usa o telefone cadastrado; o barbeiro usa exclusivamente notification_phone (+55 e DDD), nunca o vínculo público. Registre apenas autorizações efetivamente obtidas para lembretes no WhatsApp e mantenha a comprovação fora da aplicação. Contato da reserva e marketing_consent não são convertidos em opt-in. Trocar o telefone do cliente revoga o consentimento automaticamente; a interface exige nova confirmação ao editar o telefone de notificação do barbeiro. O consentimento pode ser revogado nessa mesma área.

O histórico possui filtros por tipo, status e período do horário programado em America/Fortaleza, com páginas de 50 itens. Mostra telefone, destinatário, tentativas, datas, ID do provedor e código de erro sanitizado. Somente administradores com MFA podem consultar ou configurar. A fila não aceita escrita direta de anon/authenticated. RPCs internas não herdam EXECUTE público; apenas service_role pode adquirir/finalizar trabalho.

### Backend e agendador

appointment-reminders.mjs exporta schedule '* * * * *': execução a cada minuto no deploy publicado do Netlify. Processa até um item por execução (máximo nominal 60 por hora, compartilhado entre clientes e barbeiros), para respeitar o orçamento da função. Picos atrasam envios; mensagens cujo atendimento já começou são canceladas. A frequência não promete execução no segundo exato. Não é um endpoint público de envio. Em desenvolvimento use Netlify Dev e netlify functions:invoke appointment-reminders; em previews use Run now no painel Netlify. Não há agendamento automático no Vite ou Netlify Dev. Fonte: [Scheduled Functions](https://docs.netlify.com/build/functions/scheduled-functions/).

A fila é criada/reconciliada dentro das transações de agendamentos e alterações de contato e configuração, e novamente antes da aquisição. A chave única (appointment_id, revision, recipient_type) impede duplicar o mesmo lembrete. Remarcar incrementa a revisão, cancela pendências anteriores e cria novas. Cancelar, concluir, faltar, revogar consentimento ou desativar cancela pendências. Lembretes enviados ou de resultado incerto não são reabertos automaticamente. Mudanças de antecedência recalculam apenas pendências. Ativar com horário programado já passado permite processamento no próximo ciclo, desde que o atendimento ainda não tenha começado.

Workers, configurações e reservas compartilham o lock transacional existente. Cada aquisição tem UUID e lease de dois minutos. Durante esse intervalo, alterações no agendamento, seus serviços, cliente ou barbeiro retornam erro recuperável: aguarde e tente novamente. O timeout da chamada Meta é de oito segundos; um worker atrasado não inicia envio fora da janela. Cancelamento confirmado antes da aquisição impede envio. Uma mensagem já aceita pela Meta não pode ser recolhida.

No máximo quatro tentativas, com espera de 2, 4 e 8 minutos para rejeições explícitas de limite temporário (HTTP 429, Meta 130429/131056). Erros permanentes encerram o item. Timeouts, respostas ambíguas, HTTP 5xx e leases expirados recebem OUTCOME_UNKNOWN e não são reenviados automaticamente: não existe transação distribuída com a Meta, portanto não se promete exactly-once de entrega. Essa escolha evita duplicidade após aceitação com resposta perdida, mas pode deixar uma mensagem sem envio. Investigue na conta Meta antes de qualquer intervenção manual. Não existe botão para reenviar falhas nesta etapa.

### Variáveis futuras — somente ambiente das Functions no Netlify

Não use prefixo VITE_ nem registre credenciais em arquivos, tabelas ou logs. Nenhuma variável real foi alterada.

| Variável | Finalidade |
|---|---|
| SUPABASE_URL | URL do projeto existente |
| SUPABASE_SERVICE_ROLE_KEY | Credencial exclusivamente do worker no backend; nunca do navegador |
| WHATSAPP_REMINDERS_MODE | Ausente ou dry-run: simulação; somente live habilita o adaptador real |
| META_WHATSAPP_TOKEN | Token oficial com permissão whatsapp_business_messaging |
| META_WHATSAPP_PHONE_NUMBER_ID | ID real do número remetente aprovado na Meta |
| META_GRAPH_VERSION | Versão suportada pela conta, formato vNN.N, sem versão inventada/padrão |
| META_CLIENT_REMINDER_TEMPLATE | Nome do template aprovado para clientes |
| META_BARBER_REMINDER_TEMPLATE | Nome do template aprovado para barbeiros |
| META_TEMPLATE_LANGUAGE | Idioma exato aprovado, por exemplo pt_BR |

Sem credencial do Supabase, o worker encerra sem acessar o banco. Em live sem configuração Meta completa, não adquire itens nem consome tentativas. O painel mostra apenas indicadores booleanos e o modo; não retorna valores secretos. A service_role existente no Supabase é privilegiada: limite seu uso ao ambiente protegido das Functions. As novas tabelas não concedem acesso direto nem a esse papel; suas operações passam pelas RPCs SECURITY DEFINER.

### Templates a criar no WhatsApp Manager

Crie e submeta à aprovação dois templates transacionais, com apenas BODY e parâmetros posicionais de texto, no idioma configurado. Nomes sugeridos, não existentes por pressuposição: georocha_lembrete_cliente e georocha_lembrete_barbeiro. A Meta decide a aprovação/categoria; confirme a elegibilidade de cada destinatário antes da ativação.

- Cliente: Olá, {{1}}! Seu atendimento na GEO’ROCHA com {{2}} está marcado para {{3}}. Te esperamos! Parâmetros: nome real do cliente; nome real do barbeiro; data e hora em Fortaleza.
- Barbeiro: Olá, {{1}}! Atendimento de {{2}} em {{3}}. Serviços: {{4}}. Duração prevista: {{5}} minutos. Parâmetros: barbeiro; cliente; data e hora; serviços históricos do agendamento; duração real somada.

O backend envia exclusivamente type=template para graph.facebook.com e nunca substitui templates por texto livre. A data explícita evita dizer “hoje” quando a antecedência for de dias. Referência oficial: [Templates da Meta](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/messages/template/) e [coleção oficial da Meta](https://www.postman.com/meta/whatsapp-business-platform/folder/o48mro7/messages). Não há integração com WhatsApp Web.

### Teste e ativação futura

Mantenha WHATSAPP_REMINDERS_MODE=dry-run. Habilite um tipo no painel, registre consentimento de teste e use uma reserva futura com antecedência já vencida. Execute o worker localmente ou Run now; o histórico deve exibir Enviado · SIMULADO, sem ID de provedor e sem chamada Meta. A simulação exercita fila, aquisição e conclusão reais no banco escolhido: o item simulado não será enviado novamente ao trocar para live. Use banco de teste/reservas de teste; não simule em reservas reais que devam receber o mesmo lembrete depois.

Antes de live: aplicar 009 após preflight; conferir RLS/MFA no projeto real; concluir conta oficial, número, permissões e eventual faturamento Meta; criar/aprovar templates com parâmetros correspondentes; configurar variáveis somente no backend; validar destinatários consentidos e comportamento de entrega num teste autorizado separado. Nenhuma mensagem real foi enviada nesta etapa. Status enviado significa aceito pela API, não entregue/lido: webhook de confirmação de entrega não foi implementado.

Podem existir cobranças da Meta por mensagens, além de consumo de Functions no Netlify e banco no Supabase conforme os planos. Consulte [preços oficiais do WhatsApp](https://whatsappbusiness.com/products/platform-pricing/) antes de ativar; não há orçamento nem tarifa fixa embutidos no código. Em dry-run não há chamadas cobradas pela Meta, mas a infraestrutura continua sendo utilizada.

Validação local desta etapa: npm test passou com 119 testes, incluindo concorrência em PostgreSQL, conversão de unidades e submissão duplicada na interface; npm run build e git diff --check passaram. A integração com conta Meta, Storage/Supabase remoto e inspeção visual em dispositivos reais não foram executadas.

## Etapa 10: personalização e consentimento no fluxo de agendamento

As migrações 001–009 já aplicadas não foram alteradas. Confira manualmente supabase/checks/preflight_010.sql (somente leitura) e aplique supabase/migrations/202609300010_reminder_personalization.sql antes de publicar esta versão. A 010 depende das funções e políticas da 009; nenhuma alteração foi executada remotamente. O procedimento da Etapa 9 para credenciais, agendador, retries e modo de teste continua válido.

### Interface

Lembretes agora tem Quando enviar (cards separados, antecedência em valor + unidade), Personalizar mensagens (dois editores) e Histórico. Telefone e consentimento do barbeiro são salvos no formulário completo de cadastro/edição, na mesma transação do restante dos dados e com controle de concorrência do snapshot. A área de seleção manual de destinatários foi retirada da página Lembretes.

Os editores aceitam até 1500 caracteres. Os botões inserem {cliente}, {barbeiro}, {data}, {horario}, {servicos} e {duracao} no cursor/substituem o trecho selecionado. A prévia usa dados fictícios rotulados como exemplo. Variáveis desconhecidas, chaves incompletas e mensagens vazias são recusadas na interface, API e banco. O texto é renderizado como texto simples, sem HTML e sem expansão recursiva de variáveis presentes nos dados de clientes.

### Relação com os templates oficiais

O texto personalizado controla as simulações. Ele não é enviado como texto livre à Meta, não cria um template e não altera o template aprovado do modo live. As variáveis são resolvidas a partir dos dados reais da reserva, com data e horário em America/Fortaleza. Na aquisição de um item simulado, a mensagem resultante é gravada em appointment_reminders.rendered_message e pode ser aberta no histórico. Edições posteriores não mudam essa mensagem registrada. Simulações antigas, anteriores à 010, não têm um texto reconstruído artificialmente.

O adaptador live permanece com o contrato da Etapa 9: template de cliente recebe nome do cliente, nome do barbeiro e data/hora combinadas; template de barbeiro recebe nome do barbeiro, cliente, data/hora combinadas, serviços e duração. {data} e {horario} no editor são campos separados apenas na simulação; o adaptador atual combina os dois em um parâmetro oficial. Os editores também oferecem {servicos}/{duracao} ao cliente, mas esses parâmetros não existem no contrato atual do template live de cliente. Para usar o novo texto em produção, crie/submeta o template correspondente, confira a aprovação e revise o mapeamento do adaptador em uma próxima etapa. Alterar apenas o nome do template no ambiente sem conferir os parâmetros não é suficiente. Nenhuma aprovação da Meta é presumida; nenhuma mensagem real foi enviada neste trabalho.

### Consentimento público

A confirmação da reserva ganhou uma caixa opcional, inicialmente desmarcada, autorizando lembretes desse agendamento pelo WhatsApp. Usa o único telefone já informado. Trocar o telefone ou iniciar uma nova reserva desmarca a opção. Não altera marketing_consent nem presume autorização a partir do consentimento obrigatório de cadastro/contato.

A RPC ganhou uma assinatura com p_whatsapp_consent boolean. O valor, telefone autorizado e instante do aceite ficam vinculados ao agendamento (whatsapp_reminder_consent, reminder_consent_phone, reminder_consent_at). A autorização de uma reserva não habilita outras reservas do mesmo telefone nem altera o consentimento global de um cliente existente. False impede lembretes dessa reserva mesmo que exista uma preferência global anterior. Reservas legadas ou administrativas com o campo NULL preservam a regra da 009, baseada em clients.whatsapp_reminder_consent. Alterar o telefone cadastrado invalida autorizações específicas para o telefone anterior.

A assinatura antiga da RPC continua disponível, mas novas reservas por ela não recebem opt-in de WhatsApp. A recuperação idempotente de comprovantes anteriores continua compatível. Alterar o consentimento no mesmo UUID de solicitação é rejeitado; o navegador cria um UUID novo quando o conteúdo muda. O RPC administrativo revoke_client_reminder_consent, com MFA e lock da agenda, permite revogar autorizações de reservas futuras e a preferência global; o endpoint administrativo anterior de revogação passa a usá-lo. Não há endpoint público para consultar ou editar clientes existentes. O fluxo registra uma declaração de consentimento, sem verificação de posse do telefone por OTP.

### Validação e preservação

Os testes cobrem autorização/MFA/RLS, consentimento opcional e por reserva, repetição de requisição, alteração de consentimento no mesmo UUID, texto com variáveis inválidas, renderização não recursiva, snapshot do histórico simulado, telefone do barbeiro salvo atomicamente, inserção no cursor e workers concorrentes com a 010 aplicada. Agendamentos, valores, serviços e histórico anteriores são preservados. As travas, tentativas máximas, backoff, critérios de elegibilidade e bloqueio de reenvio incerto da 009 continuam ativos.

Resultado local da Etapa 10: 124 testes passaram na suíte completa, incluindo PostgreSQL concorrente e interação no formulário público. npm run build e git diff --check passaram. Não foram executados SQL remoto, envio real pela Meta, commit, push ou merge.
