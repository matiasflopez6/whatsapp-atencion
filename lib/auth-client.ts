"use client";

import { createAuthClient } from "better-auth/react";

// Sin baseURL: usa el origen actual, así no hace falta exponer la URL pública al cliente.
export const authClient = createAuthClient();
