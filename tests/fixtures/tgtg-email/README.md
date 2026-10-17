# Too Good To Go e-mail fixtures (SYNTHETIC)

Every `.eml` file here is **synthetic**: written by hand to mirror the store notifications Too Good To Go sends a
partner account (one e-mail per reservation, one per cancellation), in French and in English. No real e-mail, customer,
address or order code is used. Too Good To Go publishes no format for these e-mails and no public sample was found, so
the reader (`lib/foodhub/tgtg-email/parse.ts`) is built from separate, tolerant patterns (labelled lines, sentences,
subject) and tested against several layouts: plain text, HTML tables, multipart, quoted-printable, a.m./p.m. times.

When the first real TGTG e-mail reaches Food Hub, compare it with these files; anything the reader misses lands in the
attention list (Settings → Platforms → Too Good To Go e-mails), never dropped. Add a new synthetic fixture with the same
layout (names and codes replaced) and a test case.
