import { defaultCredentials } from "@databricks/sdk-auth/credentials";
import type { Credentials } from "@databricks/sdk-auth";
import { resolve } from "@databricks/sdk-core/profiles";
import type IAuthentication from "@databricks/sql/dist/connection/contracts/IAuthentication";

/** Adapter only: identity, endpoint discovery, token caching and refresh belong to the Databricks SDK. */
export function managedAuthentication(host: string): IAuthentication {
  let credentials: Promise<Credentials> | undefined;
  function load() {
    if (!credentials) {
      const inApp = Boolean(process.env.DATABRICKS_APP_NAME);
      credentials = resolve({ noProfile: inApp })
        .then((profile) =>
          defaultCredentials({
            profile: {
              ...profile,
              host: `https://${host}`,
              // Deployed Apps use their injected identity, never a local token/profile.
              ...(inApp ? { authType: "oauth-m2m", token: undefined } : {}),
            },
          }),
        )
        .catch((error) => {
          credentials = undefined;
          throw error;
        });
    }
    return credentials;
  }
  return {
    async authenticate() {
      const provider = await load();
      return Object.fromEntries(
        (await provider.authHeaders()).map((header) => [
          header.key,
          header.value,
        ]),
      );
    },
  };
}
