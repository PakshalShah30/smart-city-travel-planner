CREATE TABLE "categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cities" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"country" text NOT NULL,
	"center" geometry(point) NOT NULL,
	"default_radius_m" integer DEFAULT 5000 NOT NULL,
	"timezone" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "itineraries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"city_id" integer NOT NULL,
	"share_slug" text,
	"title" text NOT NULL,
	"start_label" text NOT NULL,
	"start_location" geometry(point) NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"budget_min" integer NOT NULL,
	"interests" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"total_score" double precision DEFAULT 0 NOT NULL,
	"total_travel_s" integer DEFAULT 0 NOT NULL,
	"total_visit_s" integer DEFAULT 0 NOT NULL,
	"solver" text NOT NULL,
	"solve_ms" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "itinerary_stops" (
	"id" serial PRIMARY KEY NOT NULL,
	"itinerary_id" uuid NOT NULL,
	"poi_id" integer NOT NULL,
	"seq" integer NOT NULL,
	"arrive_at" timestamp with time zone NOT NULL,
	"depart_at" timestamp with time zone NOT NULL,
	"travel_from_prev_s" integer NOT NULL,
	"score" double precision DEFAULT 0 NOT NULL,
	"locked" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "poi_categories" (
	"poi_id" integer NOT NULL,
	"category_id" integer NOT NULL,
	CONSTRAINT "poi_categories_poi_id_category_id_pk" PRIMARY KEY("poi_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "pois" (
	"id" serial PRIMARY KEY NOT NULL,
	"city_id" integer NOT NULL,
	"source" text NOT NULL,
	"source_id" text NOT NULL,
	"name" text NOT NULL,
	"location" geometry(point) NOT NULL,
	"visit_duration_min" integer NOT NULL,
	"popularity" real DEFAULT 0 NOT NULL,
	"rating" real,
	"rating_count" integer,
	"primary_category_id" integer,
	"opening_hours" jsonb,
	"address" text,
	"photo_ref" text,
	"tags" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "travel_times" (
	"from_poi_id" integer NOT NULL,
	"to_poi_id" integer NOT NULL,
	"mode" text NOT NULL,
	"duration_s" integer NOT NULL,
	"distance_m" integer NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "travel_times_from_poi_id_to_poi_id_mode_pk" PRIMARY KEY("from_poi_id","to_poi_id","mode")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "itineraries" ADD CONSTRAINT "itineraries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itineraries" ADD CONSTRAINT "itineraries_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itinerary_stops" ADD CONSTRAINT "itinerary_stops_itinerary_id_itineraries_id_fk" FOREIGN KEY ("itinerary_id") REFERENCES "public"."itineraries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itinerary_stops" ADD CONSTRAINT "itinerary_stops_poi_id_pois_id_fk" FOREIGN KEY ("poi_id") REFERENCES "public"."pois"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poi_categories" ADD CONSTRAINT "poi_categories_poi_id_pois_id_fk" FOREIGN KEY ("poi_id") REFERENCES "public"."pois"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poi_categories" ADD CONSTRAINT "poi_categories_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pois" ADD CONSTRAINT "pois_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pois" ADD CONSTRAINT "pois_primary_category_id_categories_id_fk" FOREIGN KEY ("primary_category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_times" ADD CONSTRAINT "travel_times_from_poi_id_pois_id_fk" FOREIGN KEY ("from_poi_id") REFERENCES "public"."pois"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_times" ADD CONSTRAINT "travel_times_to_poi_id_pois_id_fk" FOREIGN KEY ("to_poi_id") REFERENCES "public"."pois"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_slug_key" ON "categories" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "cities_slug_key" ON "cities" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "cities_center_idx" ON "cities" USING gist ("center");--> statement-breakpoint
CREATE UNIQUE INDEX "itineraries_share_slug_key" ON "itineraries" USING btree ("share_slug");--> statement-breakpoint
CREATE INDEX "itineraries_user_idx" ON "itineraries" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "itinerary_stops_seq_key" ON "itinerary_stops" USING btree ("itinerary_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "pois_source_key" ON "pois" USING btree ("source","source_id");--> statement-breakpoint
CREATE INDEX "pois_city_idx" ON "pois" USING btree ("city_id");--> statement-breakpoint
CREATE INDEX "pois_location_idx" ON "pois" USING gist ("location");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree ("email");