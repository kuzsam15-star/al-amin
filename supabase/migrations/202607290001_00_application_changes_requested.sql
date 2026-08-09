-- PostgreSQL requires a committed enum value before it is used in constraints,
-- triggers or functions. Keep this as its own migration transaction.
alter type public.application_status add value if not exists 'changes_requested';
