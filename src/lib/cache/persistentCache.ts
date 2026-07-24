import { prisma } from "../prisma";

export async function getCachedData<T>(key: string): Promise<T | null> {
  try {
    const item = await prisma.apiCache.findUnique({
      where: { key },
    });

    if (!item) return null;

    if (new Date() >= new Date(item.expiresAtUtc)) {
      await prisma.apiCache.delete({ where: { key } }).catch(() => {});
      return null;
    }

    return item.value as T;
  } catch (error) {
    console.error(`Error de lectura en cache persistente (${key}):`, error);
    return null;
  }
}

export async function setCachedData<T>(
  key: string,
  value: T,
  ttlSeconds: number = 86400
): Promise<void> {
  try {
    const expiresAtUtc = new Date(Date.now() + ttlSeconds * 1000);
    await prisma.apiCache.upsert({
      where: { key },
      create: {
        key,
        value: value as any,
        expiresAtUtc,
      },
      update: {
        value: value as any,
        expiresAtUtc,
      },
    });
  } catch (error) {
    console.error(`Error de escritura en cache persistente (${key}):`, error);
  }
}
