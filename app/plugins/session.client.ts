// Exchange a hub launch token for a session (or find the existing one) before
// the first page renders.
export default defineNuxtPlugin(async () => {
    await useCasinoSession().boot()
})
