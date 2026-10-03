# GEO'ROCHA BARBEARIA — Site institucional

Landing page (one page) em React + Vite para a GEO'ROCHA BARBEARIA, com agendamento
integrado ao WhatsApp de cada barbeiro.

## 1. Como instalar

Pré-requisito: [Node.js](https://nodejs.org) 18 ou superior instalado.

```bash
npm install
```

## 2. Como rodar localmente

```bash
npm run dev
```

Abra o endereço que aparecer no terminal (geralmente `http://localhost:5173`).

## 3. Como gerar a versão para publicar (build)

```bash
npm run build
```

Os arquivos finais vão para a pasta `dist/`. Essa pasta pode ser enviada para qualquer
hospedagem (Vercel, Netlify, Hostinger, etc.).

Para conferir a build antes de publicar:

```bash
npm run preview
```

## 4. ⚠️ ONDE COLOCAR OS NÚMEROS DE WHATSAPP (obrigatório)

Abra o arquivo:

```
src/data/barbeiros.js
```

Substitua:

```js
export const BARBEIROS = {
  geovane: {
    ...
    whatsapp: "COLOCAR_NUMERO_DO_GEOVANE_AQUI",
  },
  daniel: {
    ...
    whatsapp: "COLOCAR_NUMERO_DO_DANIEL_AQUI",
  },
};

export const WHATSAPP_BARBEARIA = "COLOCAR_NUMERO_DO_WHATSAPP_DA_BARBEARIA_AQUI";
```

pelos números reais, **apenas dígitos**, no formato:
`código do país + DDD + número`.

Exemplo para um número de Teresina-PI: `5586999998888`
(55 = Brasil, 86 = DDD, restante = número).

- `BARBEIROS.geovane.whatsapp` → número do Geovane (recebe os agendamentos marcados com ele)
- `BARBEIROS.daniel.whatsapp` → número do Daniel (recebe os agendamentos marcados com ele)
- `WHATSAPP_BARBEARIA` → número usado no botão flutuante e na seção de contato

Enquanto os números não forem preenchidos, o formulário mostra um aviso claro em vez de
quebrar.

## 5. Onde colocar endereço, Instagram e link do Google Maps

Mesmo arquivo, `src/data/barbeiros.js`, bloco `CONTATO`:

```js
export const CONTATO = {
  endereco: "R. Rui Barbosa, 4499 — São Joaquim, Teresina - PI",
  instagram: "@georochabarbearia",
  instagramUrl: "https://instagram.com/georochabarbearia",
  googleMapsUrl: "COLOCAR_LINK_DO_GOOGLE_MAPS_AQUI",
};
```

- `endereco` e `instagram` já vêm preenchidos com os dados reais que aparecem no
  print do Instagram enviado — confira se estão corretos e ajuste se necessário.
- `googleMapsUrl`: abra o Google Maps, encontre a barbearia, clique em **Compartilhar**
  → **Copiar link** e cole aqui. Enquanto não for preenchido, o botão "Abrir no Google
  Maps" fica inativo.

## 6. Sobre as imagens usadas

As únicas imagens reais enviadas foram 3 capturas de tela (prints), das quais foram
aproveitadas:

- a **logo** (círculo vinho "GEO'ROCHA BARBEARIA"), usada no cabeçalho, no herói, no
  rodapé e como favicon;
- 1 foto do **ambiente** da barbearia (miniatura do Instagram), usada como imagem de
  fundo do topo (levemente desfocada, para disfarçar a baixa resolução) e na seção
  "Sobre";
- 5 miniaturas de **cortes** do feed do Instagram, usadas na galeria "Nossos Cortes".

Essas miniaturas vieram em baixa resolução (prints de grade do Instagram, ~245×245px) e
alguns cortes ainda mostram o ícone de "play" do post original. O site já está pronto
para receber fotos melhores: basta substituir os arquivos em `src/assets/images/`
(mantendo o mesmo nome de arquivo) por fotos em alta resolução para um resultado
totalmente profissional.

Não havia fotos individuais dos barbeiros Geovane e Daniel nos arquivos enviados — os
cards deles usam um monograma elegante (inicial do nome) como espaço reservado. Para
adicionar as fotos reais:

1. Coloque os arquivos em `src/assets/images/` (ex.: `barbeiro-geovane.jpg`).
2. Em `src/data/barbeiros.js`, importe a imagem no topo do arquivo e defina o campo
   `foto` de cada barbeiro com a imagem importada — ou, mais simples, abra
   `src/components/Barbeiros.jsx` e siga o comentário já deixado lá.

## 7. Estrutura de pastas

```
georocha-barbearia/
├── index.html
├── package.json
├── vite.config.js
├── public/
│   ├── favicon.png
│   └── favicon-32.png
└── src/
    ├── main.jsx
    ├── App.jsx
    ├── index.css
    ├── data/
    │   └── barbeiros.js       # NÚMEROS DE WHATSAPP, HORÁRIOS, CONTATO
    ├── assets/
    │   └── images/            # logo, foto do ambiente, fotos dos cortes
    └── components/
        ├── Header.jsx
        ├── Hero.jsx
        ├── About.jsx
        ├── Gallery.jsx
        ├── Barbeiros.jsx
        ├── Horarios.jsx
        ├── Agendamento.jsx
        ├── Contato.jsx
        ├── Footer.jsx
        └── WhatsappFloat.jsx
```

## 8. O que já foi testado

- **Formulário de agendamento**: valida nome, data, horário e barbeiro; bloqueia datas
  passadas e domingos; só mostra horários dentro do expediente (09:00–12:00 e
  14:00–20:00, intervalos de 30 min); mostra mensagem amigável quando algo está
  faltando.
- **Envio para o WhatsApp**: ao confirmar, monta a mensagem com nome, data, horário e
  barbeiro e abre `https://wa.me/<numero>?text=...` numa nova aba, usando o número do
  barbeiro escolhido.
- **Navegação**: cliques no menu (desktop e mobile) rolam suavemente até cada seção;
  "Agendar com Geovane/Daniel" leva até o formulário com o barbeiro já selecionado.
- **Responsividade**: layout testado mentalmente em larguras de ~360px (celular),
  ~768px (tablet) e acima de 1200px (desktop) — grid da galeria, cards dos barbeiros,
  formulário e menu se adaptam sem cortes ou sobreposições.

## 9. Próximos passos sugeridos (não implementados nesta versão)

O código já está organizado (dados separados em `src/data`, componentes isolados) para
facilitar, no futuro:

- Banco de dados e agenda real (horários ocupados por barbeiro);
- Painel administrativo;
- Confirmação automática e notificações;
- Cancelamento de agendamento.
