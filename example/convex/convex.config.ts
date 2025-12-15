import { defineApp } from "convex/server";
import databaseChat from "@dayhaysoos/convex-database-chat/convex.config";

const app = defineApp();
app.use(databaseChat);

export default app;
