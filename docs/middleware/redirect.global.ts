export default defineNuxtRouteMiddleware((to) => {
  if (to.path === "/") {
    return navigateTo("/fr", { redirectCode: 301 });
  }
});
