import { z } from 'zod';

const publicEnvironmentSchema = z.object({
  NEXT_PUBLIC_APP_NAME: z.string().trim().min(1).default('CodexFlow'),
});

export type PublicEnvironment = {
  appName: string;
};

export function getPublicEnvironment(
  input: Record<string, string | undefined> = process.env,
): PublicEnvironment {
  const parsed = publicEnvironmentSchema.parse(input);

  return { appName: parsed.NEXT_PUBLIC_APP_NAME };
}
