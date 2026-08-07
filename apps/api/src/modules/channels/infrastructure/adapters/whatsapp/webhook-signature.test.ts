import { describe, expect, it } from "vitest";
import {
  resolveVerificationChallenge,
  signPayload,
  verifyWebhookSignature,
} from "./webhook-signature";

const APP_SECRET = "un-app-secret-de-prueba";
const BODY = '{"object":"whatsapp_business_account","entry":[{"id":"1"}]}';

describe("Firma del webhook de WhatsApp", () => {
  it("acepta una firma correcta", () => {
    expect(
      verifyWebhookSignature({
        rawBody: BODY,
        header: signPayload(BODY, APP_SECRET),
        appSecret: APP_SECRET,
      }),
    ).toBe(true);
  });

  it("rechaza un cuerpo alterado", () => {
    const header = signPayload(BODY, APP_SECRET);

    expect(
      verifyWebhookSignature({
        rawBody: `${BODY} `,
        header,
        appSecret: APP_SECRET,
      }),
    ).toBe(false);
  });

  it("rechaza otro secreto", () => {
    expect(
      verifyWebhookSignature({
        rawBody: BODY,
        header: signPayload(BODY, "otro-secreto"),
        appSecret: APP_SECRET,
      }),
    ).toBe(false);
  });

  it("rechaza si no hay cabecera", () => {
    expect(
      verifyWebhookSignature({ rawBody: BODY, header: undefined, appSecret: APP_SECRET }),
    ).toBe(false);
  });

  it("rechaza una cabecera sin el prefijo esperado", () => {
    const hex = signPayload(BODY, APP_SECRET).slice("sha256=".length);

    expect(verifyWebhookSignature({ rawBody: BODY, header: hex, appSecret: APP_SECRET })).toBe(
      false,
    );
  });

  it("rechaza si no hay secreto configurado", () => {
    // Sin App Secret, la firma no se puede comprobar: aceptar sería abrir el
    // webhook a cualquiera.
    expect(
      verifyWebhookSignature({ rawBody: BODY, header: signPayload(BODY, ""), appSecret: "" }),
    ).toBe(false);
  });

  it("hay que firmar el cuerpo CRUDO: reserializar el JSON invalida la firma", () => {
    // Un cuerpo con el formato tal cual llega por el cable.
    const crudo = '{\n  "text": "Medellín, ¿cómo estás?"\n}';
    const header = signPayload(crudo, APP_SECRET);

    // Esto es lo que tendríamos si firmáramos el objeto ya parseado.
    const reserializado = JSON.stringify(JSON.parse(crudo));

    expect(verifyWebhookSignature({ rawBody: crudo, header, appSecret: APP_SECRET })).toBe(true);
    expect(reserializado).not.toBe(crudo);
    expect(
      verifyWebhookSignature({ rawBody: reserializado, header, appSecret: APP_SECRET }),
    ).toBe(false);
  });
});

describe("Verificación inicial del webhook", () => {
  it("devuelve el challenge cuando el token coincide", () => {
    expect(
      resolveVerificationChallenge({
        mode: "subscribe",
        token: "mi-token",
        challenge: "1158201444",
        expectedToken: "mi-token",
      }),
    ).toBe("1158201444");
  });

  it("rechaza un token distinto", () => {
    expect(
      resolveVerificationChallenge({
        mode: "subscribe",
        token: "otro",
        challenge: "1158201444",
        expectedToken: "mi-token",
      }),
    ).toBeNull();
  });

  it("rechaza un modo distinto de subscribe", () => {
    expect(
      resolveVerificationChallenge({
        mode: "unsubscribe",
        token: "mi-token",
        challenge: "x",
        expectedToken: "mi-token",
      }),
    ).toBeNull();
  });

  it("rechaza si falta el challenge", () => {
    expect(
      resolveVerificationChallenge({
        mode: "subscribe",
        token: "mi-token",
        challenge: undefined,
        expectedToken: "mi-token",
      }),
    ).toBeNull();
  });
});
