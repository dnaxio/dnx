export default defineNuxtConfig({
  experimental: {
    viteEnvironmentApi: true,
  },
  extends: ["docus"],
  modules: ["@comark/nuxt", "@nuxtjs/i18n"],
  i18n: {
    defaultLocale: "en",
    locales: [
      { code: "en", name: "English" },
      { code: "fr", name: "Français" },
    ],
  },
});
