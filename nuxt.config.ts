import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
    modules: [
        'shadcn-nuxt',
        '@nuxtjs/color-mode',
        '@vueuse/nuxt'
    ],

    // A client-rendered SPA: games are canvas/DOM toys behind a session, so
    // there is nothing to server-render and no hydration to keep in sync.
    ssr: false,

    devtools: { enabled: false },

    // shadcn-nuxt registers app/components/ui itself; everything else
    // auto-registers with its folder as prefix (casino/Lobby.vue → CasinoLobby).
    components: [
        { path: '~/components', extensions: ['vue'], ignore: ['ui/**'] }
    ],

    css: ['~/assets/css/main.css'],

    // Dev-only pages (the floor sandbox) never ship in a production build.
    ignore: process.env.NODE_ENV === 'production' ? ['**/pages/dev/**'] : [],

    shadcn: {
        prefix: '',
        componentDir: './app/components/ui'
    },

    colorMode: {
        preference: 'dark',
        fallback: 'dark',
        classSuffix: ''
    },

    sourcemap: { server: false, client: false },

    compatibilityDate: '2025-01-15',

    nitro: {
        preset: 'bun',
        logLevel: 2,
        // The live tables talk over WebSockets (server/api/tables/[slug]/ws.ts).
        experimental: { websocket: true },
        // bun:sqlite is a Bun builtin; never try to bundle it.
        externals: { external: ['bun:sqlite'] },
        // Tests and scripts exercise server and shared code, so they typecheck
        // with the server project (Nitro globals, bun types).
        typescript: {
            tsConfig: {
                include: ['../test/**/*', '../scripts/**/*'],
                compilerOptions: { types: ['bun'] }
            }
        }
    },

    vite: {
        plugins: [tailwindcss()],
        build: {
            reportCompressedSize: false
        }
    }
})
