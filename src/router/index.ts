import { createRouter, createWebHistory } from "vue-router";
import ChatPage from "../pages/ChatPage.vue";
import ChatPageText from "../pages/ChatPageText.vue";

const routes = [
  {
    path: "/",
    name: "home",
    component: ChatPageText,
  },
  {
    path: "/chat",
    name: "chat",
    component: ChatPage,
  },
  {
    path: "/chattext",
    name: "chattext",
    component: ChatPageText,
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

export default router;
