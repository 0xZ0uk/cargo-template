import { encodeCookieNamePart } from "./encodeCookieNamePart";

export function defaultGetExpCookieName(key: string) {
  return `exp_${encodeCookieNamePart(key)}`;
}
