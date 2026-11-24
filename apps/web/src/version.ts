import { inDesktopApp } from "./db/native";
import { inPhoneApp } from "./phone-app";

declare const __CUBEHAUS_VERSION__: string;

export function appVersion(): string {
  if (inDesktopApp() || inPhoneApp()) return __CUBEHAUS_VERSION__;
  const build =
    import.meta.env.VITE_TEST_HOOKS === "1"
      ? "0000000"
      : document.querySelector<HTMLMetaElement>('meta[name="cubehaus-build"]')
          ?.content;
  return build ? `${__CUBEHAUS_VERSION__} ${build}` : __CUBEHAUS_VERSION__;
}
