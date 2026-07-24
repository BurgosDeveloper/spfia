import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { username, password } = await req.json();

    const expectedUser = process.env.ADMIN_USERNAME || "admin";
    const expectedPass = process.env.ADMIN_PASSWORD || "spfia_admin_2026";

    if (username === expectedUser && password === expectedPass) {
      const response = NextResponse.json({ ok: true, message: "Login exitoso" });
      
      response.cookies.set({
        name: "spfia_session",
        value: "active_admin_session_token",
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/",
        maxAge: 86400 * 7, // 7 días
      });

      return response;
    }

    return NextResponse.json(
      { ok: false, error: "Usuario o contraseña incorrectos" },
      { status: 401 }
    );
  } catch (err) {
    return NextResponse.json({ ok: false, error: "Error en el servidor" }, { status: 500 });
  }
}
