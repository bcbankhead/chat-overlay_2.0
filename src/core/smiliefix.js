// Cleaned copies of the engine smilies whose edges carry a white matte: their anti-aliased
// rim was flattened onto white, so it shows as white pixels round the face on the dark
// theme. Each copy is the site's own GIF with the light, unsaturated pixels connected to its
// transparent outside made transparent; every frame, timing and the palette are unchanged.
// Swapped in by file name wherever a smilie is shown (the message view, the smiley picker).

/** @type {Readonly<Record<string, string>>} */
export const FIXED_SMILIES = Object.freeze({
  // :d
  'biggrin.gif':
    'data:image/gif;base64,R0lGODlhFAAUAOZ7APjbHvrdH/HPGv7lIv7kIaKYfGVQHd3d2OTl4+/y9OnCFvzhIJKFY+7x8vnbH+/MGeK3EnhnPGJNGV9JFNHPxaOZfvLRG+a8FPbXHXVjNvXWHfDOGuS6FNTSydWhC9jY0eW8FOW7FKGWeuvGF552CndmOtmsEN+yEWxOB2lNCJtxB4lkB/PUHZJyDNTTyq19B9CbCrCTEp+VeNKyFt6wENfWz/3iIea/FtuuEG1QCKWbgdSfC6aCDXppP2lVIGlUIG9WCnJfMW9UCdWiDGZQHKeehHNhM86ZCdDOxKSDD9inDaiGD9jX0KGXe2hLCKeKEd6vENmnDb2MCaJ8C2pQCY9tCunHGd2vEMKkFbuKCbaPDuK3E96xEJtwB82aC5p+EOvFF+/RHP/lIu/y85pvB9i3F+fEGNXUzOS8FrSNDq2PEnhmO86dC2xTCtLQx8CSC76QC3tqQJOGZdOwFc2qFOzJGWdTHu7MGv/mIkM0EP////X5/QAAAAAAAAAAAAAAACH5BAEAAHsALAAAAAAUABQAAAf5gHuCg4SFhoZFcRISPTqHhQVtTzN3dXRJVAWPexlfYQABAQAaG2gtGYc+WAALBAMDBAsAFgppP4VyMQ42eb14vXkOAhdTDIRALAt5eMzNYnkYIzg5g01qAATN2ngEAA8QJCKCEWUBA9vNAwECHG8RggZWAb7oA70cbAbwZgB5esAA/eXZ4kXfnghzMPjTw7BhwzxcpKwRJGKJAAcLHTLMcyGKChmDhNyw0E/jPwVQYKAgxICHgg0aAuZRcMJDF2OE7GgBAeaBAAEPRoC44uEFkUNGqpiAECIEBBpKjqwIsqlAChJwhuzIQsaJpk2CKpSYMKFEBbBoDQUCADs=',
  // :L
  'loveit.gif':
    'data:image/gif;base64,R0lGODlhEgASAOUAAP//8NjQyKiYgHhoOGBIEOjo4KCYeGhQCKiIENCwEOjIGMioEKCACNjY0HBgMJh4EOjQGP/YGPDQGPDIGOC4EJBwCODg2GhQGMCoEP/gIOjAELiQCP/w8JCIYKiQEEAwEJh4CJiIaNjQwHBYCNioEGhICOCwEJhwCHhgONi4GMCQCP8AAMiYCGBQGNiwELiICKiACNigCJhoAODAENCYCGhIANCgCLCQCKh4AJBoCIhgAAAAAAAAAAAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQFCgA7ACwAAAAAEgASAAAGwMCdcCgYEAgDwXA5NBwQCYViwTgYmELHAxLpRiQTSsXBvGAimbT6q9lchh0P+kPP0D+RMCgkHEnsaoEfEhokJTsGCGiBjBEKJicGKCmLaXcfaXkUKkYKlR8roSuYmiwtBJ51oKKYdCamDgl/dpd3hC4vAwYwE5WNYTEyVwczEr6ZhCQ0NUIdDBoTxl5gGi42Mh1DFzcUGgoTEwoaFCQ2OG9LDjkkJhQUJi4xLDpkWAYlJxs2NC8yJVdYiBhBooRJEAAh+QQFCgA7ACwGAAcABgAHAAAGE8CMcEgsDj/I5GfFXCGbzohyEgQAOw==',
  // :o
  'omg.gif':
    'data:image/gif;base64,R0lGODlhFAAUAOZ7AP/lIvrdH/7lIv7kIfHPGvzhIOTl4+/y9OnCFt3d2GVQHaKYfPnbH+/MGZKFY+7x8v3iIfbXHfLRG+K3EvDOGnhnPOW8FOS6FOa8FKOZfuW7FNjY0f8CAPXWHXVjNp52CmJNGV9JFHdmOqGWetTSydHPxdWhC+vGF9jX0Ni3F9TTymxOB9DOxKJ8C7SNDnJfMWlNCOzJGdmsENLQx+S8FsCSC5JyDOa/FtuuEM2aC3tqQO7MGmlVIN6xEGlUIPPUHWxTCr6QC2hLCL2MCa2PEqaCDdCbCraPDtSfC9mnDe/RHJ+VeN+yEd6wEG9WCmdTHppvB86ZCWpQCa19B9inDenHGZp+ELCTEsKkFeK3E6eKEe/y829UCaiGD86dC6SDD6WbgdXUzKeehJOGZbuKCYlkB21QCGZQHM2qFJtxB9OwFevFF9fWz3hmO5twB92vEI9tCufEGKGXe9WiDHNhM96vENKyFnppP/jbHkM0EP/mIvX5/QAAAAAAAAAAAAAAACH5BAEAAHsALAAAAAAUABQAAAf7gHuCg4SFhoZiOiAgd2CHhQtAWnY7MWhfUguPex5WSngBAXgdFDQ2Hoc8WHh5eQICA60SCC4+hWNXDHkAer16ABB5BBgtDoROPwW8eb67BREnOGaDckR4A73M2XoDeA0THyOCFSkBAtvbAgEEFzUVggpV5r70eursXgrwcdf1vt0NsuTQt6eCmgjK/AF4dqLHkDaCRnQhwADCslZ5IDAYliTNkkFcbkjAUyAWRgaz6hhZQchBEQQUOrDiwCEPBQRMTLgxRujJEQtrGmDMY+GNiSlnDtGBI2OCBg0TmlCJUubFpgUwPgSZg4QMFCGaNgnKICJECBEZxKo1FAgAOw==',
});

/**
 * The source to show for an image: a cleaned copy when `src` is one of the engine's smilies
 * that has one (`…/smilies/<name>`, any query or fragment ignored), otherwise `src` itself.
 * @param {string} src
 * @returns {string}
 */
export function fixedSmilieSrc(src) {
  const name = /(?:^|\/)smilies\/([^/?#]+)(?:[?#].*)?$/.exec(src)?.[1];
  return (name !== undefined && Object.hasOwn(FIXED_SMILIES, name) && FIXED_SMILIES[name]) || src;
}
