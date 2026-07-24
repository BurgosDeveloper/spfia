import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const decision = searchParams.get("decision") || undefined;
    const league = searchParams.get("league") || undefined;
    const date = searchParams.get("date") || undefined;

    const where: any = {};
    if (decision && decision !== "ALL") where.decision = decision;
    if (league) where.candidate = { league };
    if (date) where.candidate = { ...(where.candidate || {}), date };

    const picks = await prisma.pick.findMany({
      where,
      include: {
        candidate: true,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 100,
    });

    return NextResponse.json({
      ok: true,
      count: picks.length,
      picks,
    });
  } catch (err: any) {
    console.error("Error consultando picks:", err);
    return NextResponse.json(
      { ok: false, error: err.message || "Error consultando base de datos" },
      { status: 500 }
    );
  }
}
