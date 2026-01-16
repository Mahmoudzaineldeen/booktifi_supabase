-- ============================================
-- FIXED VERSION OF DATABASE DUMP
-- ============================================
-- This is the provided dump with fixes for:
-- 1. Schema creation (uses IF NOT EXISTS)
-- 2. Removed \restrict and \unrestrict commands
-- 3. Uses CREATE OR REPLACE for functions
-- ============================================

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: auth; Type: SCHEMA; Schema: -; Owner: postgres
--

CREATE SCHEMA IF NOT EXISTS auth;
ALTER SCHEMA auth OWNER TO postgres;

--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';

--
-- Name: booking_status; Type: TYPE; Schema: public; Owner: postgres
--

DROP TYPE IF EXISTS public.booking_status CASCADE;
CREATE TYPE public.booking_status AS ENUM (
    'pending',
    'confirmed',
    'checked_in',
    'completed',
    'cancelled'
);

ALTER TYPE public.booking_status OWNER TO postgres;

--
-- Name: capacity_mode; Type: TYPE; Schema: public; Owner: postgres
--

DROP TYPE IF EXISTS public.capacity_mode CASCADE;
CREATE TYPE public.capacity_mode AS ENUM (
    'employee_based',
    'service_based'
);

ALTER TYPE public.capacity_mode OWNER TO postgres;

--
-- Name: payment_status; Type: TYPE; Schema: public; Owner: postgres
--

DROP TYPE IF EXISTS public.payment_status CASCADE;
CREATE TYPE public.payment_status AS ENUM (
    'unpaid',
    'paid_manual',
    'awaiting_payment',
    'paid',
    'refunded'
);

ALTER TYPE public.payment_status OWNER TO postgres;

--
-- Name: user_role; Type: TYPE; Schema: public; Owner: postgres
--

DROP TYPE IF EXISTS public.user_role CASCADE;
CREATE TYPE public.user_role AS ENUM (
    'solution_owner',
    'tenant_admin',
    'receptionist',
    'cashier',
    'employee',
    'customer'
);

ALTER TYPE public.user_role OWNER TO postgres;
