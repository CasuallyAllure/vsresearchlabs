export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      admin_users: {
        Row: {
          active: boolean
          created_at: string
          display_name: string | null
          email: string
          role: string
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          display_name?: string | null
          email: string
          role?: string
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          display_name?: string | null
          email?: string
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      affiliates: {
        Row: {
          active: boolean
          contact: string | null
          created_at: string
          default_commission_percent: number
          id: string
          name: string
          notes: string | null
        }
        Insert: {
          active?: boolean
          contact?: string | null
          created_at?: string
          default_commission_percent?: number
          id?: string
          name: string
          notes?: string | null
        }
        Update: {
          active?: boolean
          contact?: string | null
          created_at?: string
          default_commission_percent?: number
          id?: string
          name?: string
          notes?: string | null
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          after_value: Json | null
          before_value: Json | null
          context: Json | null
          entity_id: string | null
          entity_type: string
          id: string
          occurred_at: string
          summary: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          after_value?: Json | null
          before_value?: Json | null
          context?: Json | null
          entity_id?: string | null
          entity_type: string
          id?: string
          occurred_at?: string
          summary?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          after_value?: Json | null
          before_value?: Json | null
          context?: Json | null
          entity_id?: string | null
          entity_type?: string
          id?: string
          occurred_at?: string
          summary?: string | null
        }
        Relationships: []
      }
      automation_settings: {
        Row: {
          config: Json
          enabled: boolean
          kind: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          config?: Json
          enabled?: boolean
          kind: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          config?: Json
          enabled?: boolean
          kind?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      contact_messages: {
        Row: {
          created_at: string
          email: string
          id: string
          intake_channel: string
          message: string
          name: string
          organization: string | null
          phone: string | null
          reference_id: string
          referrer: string | null
          role_title: string | null
          source: string | null
          status: string
          topic: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          intake_channel?: string
          message: string
          name: string
          organization?: string | null
          phone?: string | null
          reference_id: string
          referrer?: string | null
          role_title?: string | null
          source?: string | null
          status?: string
          topic?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          intake_channel?: string
          message?: string
          name?: string
          organization?: string | null
          phone?: string | null
          reference_id?: string
          referrer?: string | null
          role_title?: string | null
          source?: string | null
          status?: string
          topic?: string
        }
        Relationships: []
      }
      coupon_redemptions: {
        Row: {
          affiliate_id: string | null
          buyer_contact: string | null
          code: string
          commission_cents: number
          commission_status: string
          coupon_id: string
          created_at: string
          discount_cents: number
          id: string
          order_id: string | null
          order_net_cents: number
        }
        Insert: {
          affiliate_id?: string | null
          buyer_contact?: string | null
          code: string
          commission_cents?: number
          commission_status?: string
          coupon_id: string
          created_at?: string
          discount_cents?: number
          id?: string
          order_id?: string | null
          order_net_cents?: number
        }
        Update: {
          affiliate_id?: string | null
          buyer_contact?: string | null
          code?: string
          commission_cents?: number
          commission_status?: string
          coupon_id?: string
          created_at?: string
          discount_cents?: number
          id?: string
          order_id?: string | null
          order_net_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "coupon_redemptions_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupon_redemptions_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupon_redemptions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      coupons: {
        Row: {
          active: boolean
          affiliate_id: string | null
          amount_cents: number | null
          code: string
          combines_with_account: boolean
          combines_with_codes: boolean
          combines_with_promos: boolean
          commission_percent: number | null
          created_at: string
          exclusive: boolean
          expires_at: string | null
          free_dose: string | null
          free_label: string | null
          free_sku: string | null
          id: string
          kind: string
          max_uses: number | null
          min_subtotal_cents: number
          once_per_contact: boolean
          percent: number | null
          requires_account: boolean
          starts_at: string | null
          updated_at: string
          used_count: number
        }
        Insert: {
          active?: boolean
          affiliate_id?: string | null
          amount_cents?: number | null
          code: string
          combines_with_account?: boolean
          combines_with_codes?: boolean
          combines_with_promos?: boolean
          commission_percent?: number | null
          created_at?: string
          exclusive?: boolean
          expires_at?: string | null
          free_dose?: string | null
          free_label?: string | null
          free_sku?: string | null
          id?: string
          kind: string
          max_uses?: number | null
          min_subtotal_cents?: number
          once_per_contact?: boolean
          percent?: number | null
          requires_account?: boolean
          starts_at?: string | null
          updated_at?: string
          used_count?: number
        }
        Update: {
          active?: boolean
          affiliate_id?: string | null
          amount_cents?: number | null
          code?: string
          combines_with_account?: boolean
          combines_with_codes?: boolean
          combines_with_promos?: boolean
          commission_percent?: number | null
          created_at?: string
          exclusive?: boolean
          expires_at?: string | null
          free_dose?: string | null
          free_label?: string | null
          free_sku?: string | null
          id?: string
          kind?: string
          max_uses?: number | null
          min_subtotal_cents?: number
          once_per_contact?: boolean
          percent?: number | null
          requires_account?: boolean
          starts_at?: string | null
          updated_at?: string
          used_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "coupons_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_discounts: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          label: string
          notes: string | null
          percent: number
          scope: string
          starts_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          label: string
          notes?: string | null
          percent: number
          scope: string
          starts_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          label?: string
          notes?: string | null
          percent?: number
          scope?: string
          starts_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      customer_profiles: {
        Row: {
          account_type: string
          address_line1: string | null
          address_line2: string | null
          business_name: string | null
          city: string | null
          country: string | null
          created_at: string
          customer_id: string | null
          free_shipping: boolean
          full_name: string
          marketing_opt_out: boolean
          phone: string | null
          postal_code: string | null
          state: string | null
          status: string
          tier: string
          updated_at: string
          user_id: string
        }
        Insert: {
          account_type?: string
          address_line1?: string | null
          address_line2?: string | null
          business_name?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          customer_id?: string | null
          free_shipping?: boolean
          full_name: string
          marketing_opt_out?: boolean
          phone?: string | null
          postal_code?: string | null
          state?: string | null
          status?: string
          tier?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          account_type?: string
          address_line1?: string | null
          address_line2?: string | null
          business_name?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          customer_id?: string | null
          free_shipping?: boolean
          full_name?: string
          marketing_opt_out?: boolean
          phone?: string | null
          postal_code?: string | null
          state?: string | null
          status?: string
          tier?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_profiles_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_with_history"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_profiles_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          contact: string
          contact_key: string
          display_name: string
          first_seen_at: string
          id: string
          inquiry_count: number
          last_seen_at: string
          notes: string | null
          order_count: number
          organization: string | null
          phone: string | null
          status: string
        }
        Insert: {
          contact: string
          contact_key: string
          display_name: string
          first_seen_at?: string
          id?: string
          inquiry_count?: number
          last_seen_at?: string
          notes?: string | null
          order_count?: number
          organization?: string | null
          phone?: string | null
          status?: string
        }
        Update: {
          contact?: string
          contact_key?: string
          display_name?: string
          first_seen_at?: string
          id?: string
          inquiry_count?: number
          last_seen_at?: string
          notes?: string | null
          order_count?: number
          organization?: string | null
          phone?: string | null
          status?: string
        }
        Relationships: []
      }
      email_log: {
        Row: {
          id: string
          kind: string
          metadata: Json
          period_key: string
          recipient: string
          sent_at: string
          user_id: string | null
        }
        Insert: {
          id?: string
          kind: string
          metadata?: Json
          period_key: string
          recipient: string
          sent_at?: string
          user_id?: string | null
        }
        Update: {
          id?: string
          kind?: string
          metadata?: Json
          period_key?: string
          recipient?: string
          sent_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      inquiries: {
        Row: {
          contact: string
          created_at: string
          id: string
          intake_channel: string
          item_count: number
          name: string
          notes: string | null
          organization: string | null
          processing_node: string
          reference_id: string
          ship_city: string | null
          ship_country: string | null
          ship_state: string | null
          ship_street: string | null
          ship_zip: string | null
          status: string
        }
        Insert: {
          contact: string
          created_at?: string
          id?: string
          intake_channel?: string
          item_count: number
          name: string
          notes?: string | null
          organization?: string | null
          processing_node?: string
          reference_id: string
          ship_city?: string | null
          ship_country?: string | null
          ship_state?: string | null
          ship_street?: string | null
          ship_zip?: string | null
          status?: string
        }
        Update: {
          contact?: string
          created_at?: string
          id?: string
          intake_channel?: string
          item_count?: number
          name?: string
          notes?: string | null
          organization?: string | null
          processing_node?: string
          reference_id?: string
          ship_city?: string | null
          ship_country?: string | null
          ship_state?: string | null
          ship_street?: string | null
          ship_zip?: string | null
          status?: string
        }
        Relationships: []
      }
      inquiry_items: {
        Row: {
          category: string | null
          id: string
          inquiry_id: string
          item_note: string | null
          product_name: string
          quantity: number
          sku: string
        }
        Insert: {
          category?: string | null
          id?: string
          inquiry_id: string
          item_note?: string | null
          product_name: string
          quantity: number
          sku: string
        }
        Update: {
          category?: string | null
          id?: string
          inquiry_id?: string
          item_note?: string | null
          product_name?: string
          quantity?: number
          sku?: string
        }
        Relationships: [
          {
            foreignKeyName: "inquiry_items_inquiry_id_fkey"
            columns: ["inquiry_id"]
            isOneToOne: false
            referencedRelation: "inquiries"
            referencedColumns: ["id"]
          },
        ]
      }
      lookup_order_attempts: {
        Row: {
          attempts: number
          bucket: string
          window_start: string
        }
        Insert: {
          attempts?: number
          bucket: string
          window_start?: string
        }
        Update: {
          attempts?: number
          bucket?: string
          window_start?: string
        }
        Relationships: []
      }
      member_invites: {
        Row: {
          channel: string
          contact_key: string
          converted_at: string | null
          converted_user_id: string | null
          created_at: string
          customer_id: string | null
          email: string
          id: string
          metadata: Json
          points_promised: number
          sent_at: string
          sent_by: string | null
        }
        Insert: {
          channel?: string
          contact_key: string
          converted_at?: string | null
          converted_user_id?: string | null
          created_at?: string
          customer_id?: string | null
          email: string
          id?: string
          metadata?: Json
          points_promised?: number
          sent_at?: string
          sent_by?: string | null
        }
        Update: {
          channel?: string
          contact_key?: string
          converted_at?: string | null
          converted_user_id?: string | null
          created_at?: string
          customer_id?: string | null
          email?: string
          id?: string
          metadata?: Json
          points_promised?: number
          sent_at?: string
          sent_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "member_invites_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_with_history"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_invites_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      member_referral_codes: {
        Row: {
          affiliate_id: string
          code: string
          coupon_id: string
          created_at: string
          owner_contact: string | null
          user_id: string
        }
        Insert: {
          affiliate_id: string
          code: string
          coupon_id: string
          created_at?: string
          owner_contact?: string | null
          user_id: string
        }
        Update: {
          affiliate_id?: string
          code?: string
          coupon_id?: string
          created_at?: string
          owner_contact?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_referral_codes_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_referral_codes_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
        ]
      }
      order_coupons: {
        Row: {
          amount_cents: number | null
          code: string
          created_at: string
          discount_cents: number
          free_dose: string | null
          free_label: string | null
          free_sku: string | null
          id: string
          kind: string
          order_id: string
          percent: number | null
          source: string
        }
        Insert: {
          amount_cents?: number | null
          code: string
          created_at?: string
          discount_cents?: number
          free_dose?: string | null
          free_label?: string | null
          free_sku?: string | null
          id?: string
          kind: string
          order_id: string
          percent?: number | null
          source?: string
        }
        Update: {
          amount_cents?: number | null
          code?: string
          created_at?: string
          discount_cents?: number
          free_dose?: string | null
          free_label?: string | null
          free_sku?: string | null
          id?: string
          kind?: string
          order_id?: string
          percent?: number | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_coupons_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_events: {
        Row: {
          actor: string | null
          created_at: string
          id: string
          kind: string
          note: string | null
          order_id: string
          stage: string | null
        }
        Insert: {
          actor?: string | null
          created_at?: string
          id?: string
          kind?: string
          note?: string | null
          order_id: string
          stage?: string | null
        }
        Update: {
          actor?: string | null
          created_at?: string
          id?: string
          kind?: string
          note?: string | null
          order_id?: string
          stage?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_lines: {
        Row: {
          fast_ship: boolean | null
          id: string
          item_note: string | null
          order_id: string
          product_name: string
          quantity: number
          sku: string
          unit_price_cents: number | null
        }
        Insert: {
          fast_ship?: boolean | null
          id?: string
          item_note?: string | null
          order_id: string
          product_name: string
          quantity: number
          sku: string
          unit_price_cents?: number | null
        }
        Update: {
          fast_ship?: boolean | null
          id?: string
          item_note?: string | null
          order_id?: string
          product_name?: string
          quantity?: number
          sku?: string
          unit_price_cents?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "order_lines_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_reviews: {
        Row: {
          buyer_contact: string | null
          comment: string | null
          created_at: string
          display_name: string
          id: string
          moderated_at: string | null
          moderated_by: string | null
          order_id: string
          service_rating: number
          status: string
          user_id: string | null
        }
        Insert: {
          buyer_contact?: string | null
          comment?: string | null
          created_at?: string
          display_name: string
          id?: string
          moderated_at?: string | null
          moderated_by?: string | null
          order_id: string
          service_rating: number
          status?: string
          user_id?: string | null
        }
        Update: {
          buyer_contact?: string | null
          comment?: string | null
          created_at?: string
          display_name?: string
          id?: string
          moderated_at?: string | null
          moderated_by?: string | null
          order_id?: string
          service_rating?: number
          status?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_reviews_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          buyer_contact: string | null
          buyer_name: string
          buyer_organization: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          carrier: string | null
          coupon_code: string | null
          created_at: string
          created_by: string | null
          delivered_at: string | null
          discount_cents: number
          flag_note: string | null
          flagged_at: string | null
          fulfilled_at: string | null
          id: string
          idempotency_key: string | null
          inquiry_id: string | null
          invoice_amount_cents: number | null
          invoice_url: string | null
          invoiced_at: string | null
          lookup_token: string
          notes: string | null
          order_number: string
          paid_at: string | null
          payment_claimed_at: string | null
          payment_method: string | null
          receipt_count: number
          receipt_sent_at: string | null
          research_attestation: Json | null
          ship_city: string | null
          ship_confirmed_at: string | null
          ship_country: string | null
          ship_state: string | null
          ship_street: string | null
          ship_zip: string | null
          shipped_at: string | null
          shipping_cents: number | null
          status: Database["public"]["Enums"]["order_status"]
          subtotal_cents: number | null
          tracking_number: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          buyer_contact?: string | null
          buyer_name: string
          buyer_organization?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          carrier?: string | null
          coupon_code?: string | null
          created_at?: string
          created_by?: string | null
          delivered_at?: string | null
          discount_cents?: number
          flag_note?: string | null
          flagged_at?: string | null
          fulfilled_at?: string | null
          id?: string
          idempotency_key?: string | null
          inquiry_id?: string | null
          invoice_amount_cents?: number | null
          invoice_url?: string | null
          invoiced_at?: string | null
          lookup_token?: string
          notes?: string | null
          order_number: string
          paid_at?: string | null
          payment_claimed_at?: string | null
          payment_method?: string | null
          receipt_count?: number
          receipt_sent_at?: string | null
          research_attestation?: Json | null
          ship_city?: string | null
          ship_confirmed_at?: string | null
          ship_country?: string | null
          ship_state?: string | null
          ship_street?: string | null
          ship_zip?: string | null
          shipped_at?: string | null
          shipping_cents?: number | null
          status?: Database["public"]["Enums"]["order_status"]
          subtotal_cents?: number | null
          tracking_number?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          buyer_contact?: string | null
          buyer_name?: string
          buyer_organization?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          carrier?: string | null
          coupon_code?: string | null
          created_at?: string
          created_by?: string | null
          delivered_at?: string | null
          discount_cents?: number
          flag_note?: string | null
          flagged_at?: string | null
          fulfilled_at?: string | null
          id?: string
          idempotency_key?: string | null
          inquiry_id?: string | null
          invoice_amount_cents?: number | null
          invoice_url?: string | null
          invoiced_at?: string | null
          lookup_token?: string
          notes?: string | null
          order_number?: string
          paid_at?: string | null
          payment_claimed_at?: string | null
          payment_method?: string | null
          receipt_count?: number
          receipt_sent_at?: string | null
          research_attestation?: Json | null
          ship_city?: string | null
          ship_confirmed_at?: string | null
          ship_country?: string | null
          ship_state?: string | null
          ship_street?: string | null
          ship_zip?: string | null
          shipped_at?: string | null
          shipping_cents?: number | null
          status?: Database["public"]["Enums"]["order_status"]
          subtotal_cents?: number | null
          tracking_number?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_inquiry_id_fkey"
            columns: ["inquiry_id"]
            isOneToOne: false
            referencedRelation: "inquiries"
            referencedColumns: ["id"]
          },
        ]
      }
      prepared_cart_lines: {
        Row: {
          cart_id: string
          dose: string
          id: string
          position: number
          quantity: number
          sku: string
        }
        Insert: {
          cart_id: string
          dose?: string
          id?: string
          position?: number
          quantity: number
          sku: string
        }
        Update: {
          cart_id?: string
          dose?: string
          id?: string
          position?: number
          quantity?: number
          sku?: string
        }
        Relationships: [
          {
            foreignKeyName: "prepared_cart_lines_cart_id_fkey"
            columns: ["cart_id"]
            isOneToOne: false
            referencedRelation: "prepared_carts"
            referencedColumns: ["id"]
          },
        ]
      }
      prepared_carts: {
        Row: {
          claim_count: number
          claimed_at: string | null
          converted_at: string | null
          converted_order_id: string | null
          coupon_code: string | null
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          last_claimed_at: string | null
          note: string | null
          revoked_at: string | null
          token_hash: string
          user_id: string
        }
        Insert: {
          claim_count?: number
          claimed_at?: string | null
          converted_at?: string | null
          converted_order_id?: string | null
          coupon_code?: string | null
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          last_claimed_at?: string | null
          note?: string | null
          revoked_at?: string | null
          token_hash: string
          user_id: string
        }
        Update: {
          claim_count?: number
          claimed_at?: string | null
          converted_at?: string | null
          converted_order_id?: string | null
          coupon_code?: string | null
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          last_claimed_at?: string | null
          note?: string | null
          revoked_at?: string | null
          token_hash?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prepared_carts_converted_order_id_fkey"
            columns: ["converted_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      product_flags: {
        Row: {
          early_access: boolean
          member_discount_percent: number | null
          sku: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          early_access?: boolean
          member_discount_percent?: number | null
          sku: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          early_access?: boolean
          member_discount_percent?: number | null
          sku?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      product_stock: {
        Row: {
          deleted_at: string | null
          hidden: boolean
          last_counted: string | null
          notes: string | null
          on_hand: number
          price_cents_override: number | null
          reorder_at: number | null
          sku: string
          updated_at: string
          video_description: string | null
          video_thumbnail: string | null
          video_title: string | null
          video_url: string | null
        }
        Insert: {
          deleted_at?: string | null
          hidden?: boolean
          last_counted?: string | null
          notes?: string | null
          on_hand?: number
          price_cents_override?: number | null
          reorder_at?: number | null
          sku: string
          updated_at?: string
          video_description?: string | null
          video_thumbnail?: string | null
          video_title?: string | null
          video_url?: string | null
        }
        Update: {
          deleted_at?: string | null
          hidden?: boolean
          last_counted?: string | null
          notes?: string | null
          on_hand?: number
          price_cents_override?: number | null
          reorder_at?: number | null
          sku?: string
          updated_at?: string
          video_description?: string | null
          video_thumbnail?: string | null
          video_title?: string | null
          video_url?: string | null
        }
        Relationships: []
      }
      product_supplier_links: {
        Row: {
          aliexpress_url: string
          notes: string | null
          product_id: string
          updated_at: string | null
        }
        Insert: {
          aliexpress_url: string
          notes?: string | null
          product_id: string
          updated_at?: string | null
        }
        Update: {
          aliexpress_url?: string
          notes?: string | null
          product_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_supplier_links_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_variant_stock: {
        Row: {
          cost_cents: number | null
          dose: string
          hidden: boolean
          inbound_units: number
          lead_days: number | null
          on_hand: number
          price_cents: number | null
          reorder_at: number | null
          sku: string
          updated_at: string
          wholesale_eligible: boolean
        }
        Insert: {
          cost_cents?: number | null
          dose: string
          hidden?: boolean
          inbound_units?: number
          lead_days?: number | null
          on_hand?: number
          price_cents?: number | null
          reorder_at?: number | null
          sku: string
          updated_at?: string
          wholesale_eligible?: boolean
        }
        Update: {
          cost_cents?: number | null
          dose?: string
          hidden?: boolean
          inbound_units?: number
          lead_days?: number | null
          on_hand?: number
          price_cents?: number | null
          reorder_at?: number | null
          sku?: string
          updated_at?: string
          wholesale_eligible?: boolean
        }
        Relationships: []
      }
      products: {
        Row: {
          category: string | null
          created_at: string | null
          featured: boolean | null
          id: string
          images: string[] | null
          long_description: string | null
          name: string
          price_cents: number | null
          short_description: string | null
          sku: string | null
          slug: string | null
          specs: Json | null
          stock: number | null
          tags: string[] | null
          updated_at: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string | null
          featured?: boolean | null
          id?: string
          images?: string[] | null
          long_description?: string | null
          name: string
          price_cents?: number | null
          short_description?: string | null
          sku?: string | null
          slug?: string | null
          specs?: Json | null
          stock?: number | null
          tags?: string[] | null
          updated_at?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string | null
          featured?: boolean | null
          id?: string
          images?: string[] | null
          long_description?: string | null
          name?: string
          price_cents?: number | null
          short_description?: string | null
          sku?: string | null
          slug?: string | null
          specs?: Json | null
          stock?: number | null
          tags?: string[] | null
          updated_at?: string | null
        }
        Relationships: []
      }
      promo_settings: {
        Row: {
          b2g1_enabled: boolean
          b2g1_ends_at: string | null
          b2g1_excluded_skus: string[]
          bogo_enabled: boolean
          bogo_ends_at: string | null
          bogo_excluded_skus: string[]
          id: number
          updated_at: string
        }
        Insert: {
          b2g1_enabled?: boolean
          b2g1_ends_at?: string | null
          b2g1_excluded_skus?: string[]
          bogo_enabled?: boolean
          bogo_ends_at?: string | null
          bogo_excluded_skus?: string[]
          id?: number
          updated_at?: string
        }
        Update: {
          b2g1_enabled?: boolean
          b2g1_ends_at?: string | null
          b2g1_excluded_skus?: string[]
          bogo_enabled?: boolean
          bogo_ends_at?: string | null
          bogo_excluded_skus?: string[]
          id?: number
          updated_at?: string
        }
        Relationships: []
      }
      referral_conversions: {
        Row: {
          bonus_code: string | null
          bonus_coupon_id: string | null
          created_at: string
          id: string
          order_id: string
          qualified_at: string
          referred_contact: string
          referred_user_id: string | null
          referrer_user_id: string
        }
        Insert: {
          bonus_code?: string | null
          bonus_coupon_id?: string | null
          created_at?: string
          id?: string
          order_id: string
          qualified_at?: string
          referred_contact: string
          referred_user_id?: string | null
          referrer_user_id: string
        }
        Update: {
          bonus_code?: string | null
          bonus_coupon_id?: string | null
          created_at?: string
          id?: string
          order_id?: string
          qualified_at?: string
          referred_contact?: string
          referred_user_id?: string | null
          referrer_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "referral_conversions_bonus_coupon_id_fkey"
            columns: ["bonus_coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_conversions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      reward_ledger: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          kind: string
          note: string | null
          order_id: string | null
          points: number
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          kind: string
          note?: string | null
          order_id?: string | null
          points: number
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          note?: string | null
          order_id?: string | null
          points?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reward_ledger_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      reward_vouchers: {
        Row: {
          created_at: string
          id: string
          order_id: string | null
          percent: number
          points_spent: number
          reward_kind: string
          status: string
          used_at: string | null
          user_id: string
          void_reason: string | null
          voided_at: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          order_id?: string | null
          percent: number
          points_spent: number
          reward_kind?: string
          status?: string
          used_at?: string | null
          user_id: string
          void_reason?: string | null
          voided_at?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          order_id?: string | null
          percent?: number
          points_spent?: number
          reward_kind?: string
          status?: string
          used_at?: string | null
          user_id?: string
          void_reason?: string | null
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reward_vouchers_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_movements: {
        Row: {
          admin_id: string | null
          created_at: string
          delta: number
          id: string
          notes: string | null
          on_hand_after: number
          order_id: string | null
          reason: Database["public"]["Enums"]["stock_movement_reason"]
          sku: string
        }
        Insert: {
          admin_id?: string | null
          created_at?: string
          delta: number
          id?: string
          notes?: string | null
          on_hand_after: number
          order_id?: string | null
          reason: Database["public"]["Enums"]["stock_movement_reason"]
          sku: string
        }
        Update: {
          admin_id?: string | null
          created_at?: string
          delta?: number
          id?: string
          notes?: string | null
          on_hand_after?: number
          order_id?: string | null
          reason?: Database["public"]["Enums"]["stock_movement_reason"]
          sku?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      customer_with_history: {
        Row: {
          contact: string | null
          contact_key: string | null
          display_name: string | null
          first_seen_at: string | null
          id: string | null
          inquiry_count: number | null
          last_inquiry_at: string | null
          last_order_at: string | null
          last_seen_at: string | null
          notes: string | null
          order_count: number | null
          organization: string | null
          phone: string | null
          status: string | null
        }
        Insert: {
          contact?: string | null
          contact_key?: string | null
          display_name?: string | null
          first_seen_at?: string | null
          id?: string | null
          inquiry_count?: number | null
          last_inquiry_at?: never
          last_order_at?: never
          last_seen_at?: string | null
          notes?: string | null
          order_count?: number | null
          organization?: string | null
          phone?: string | null
          status?: string | null
        }
        Update: {
          contact?: string | null
          contact_key?: string | null
          display_name?: string | null
          first_seen_at?: string | null
          id?: string | null
          inquiry_count?: number | null
          last_inquiry_at?: never
          last_order_at?: never
          last_seen_at?: string | null
          notes?: string | null
          order_count?: number | null
          organization?: string | null
          phone?: string | null
          status?: string | null
        }
        Relationships: []
      }
      member_roster_base: {
        Row: {
          account_type: string | null
          active_vouchers: number | null
          business_name: string | null
          contact: string | null
          customer_id: string | null
          discount: Json | null
          free_shipping: boolean | null
          joined_at: string | null
          last_order_at: string | null
          name: string | null
          org: string | null
          paid_orders: number | null
          points_balance: number | null
          reward_ready: boolean | null
          segment: string | null
          spend_cents: number | null
          spend_percentile: number | null
          status: string | null
          tier: string | null
          ttm_spend_cents: number | null
          user_id: string | null
          vip: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_profiles_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_with_history"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_profiles_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      public_product_flags: {
        Row: {
          early_access: boolean | null
          member_discount_percent: number | null
          sku: string | null
        }
        Insert: {
          early_access?: boolean | null
          member_discount_percent?: number | null
          sku?: string | null
        }
        Update: {
          early_access?: boolean | null
          member_discount_percent?: number | null
          sku?: string | null
        }
        Relationships: []
      }
      public_product_overrides: {
        Row: {
          deleted_at: string | null
          hidden: boolean | null
          on_hand: number | null
          price_cents_override: number | null
          sku: string | null
          video_description: string | null
          video_thumbnail: string | null
          video_title: string | null
          video_url: string | null
        }
        Insert: {
          deleted_at?: string | null
          hidden?: boolean | null
          on_hand?: number | null
          price_cents_override?: number | null
          sku?: string | null
          video_description?: string | null
          video_thumbnail?: string | null
          video_title?: string | null
          video_url?: string | null
        }
        Update: {
          deleted_at?: string | null
          hidden?: boolean | null
          on_hand?: number | null
          price_cents_override?: number | null
          sku?: string | null
          video_description?: string | null
          video_thumbnail?: string | null
          video_title?: string | null
          video_url?: string | null
        }
        Relationships: []
      }
      public_promo_settings: {
        Row: {
          b2g1_enabled: boolean | null
          b2g1_ends_at: string | null
          b2g1_excluded_skus: string[] | null
          b2g1_live: boolean | null
          bogo_enabled: boolean | null
          bogo_ends_at: string | null
          bogo_excluded_skus: string[] | null
          bogo_live: boolean | null
          id: number | null
          server_now: string | null
          updated_at: string | null
        }
        Insert: {
          b2g1_enabled?: boolean | null
          b2g1_ends_at?: string | null
          b2g1_excluded_skus?: string[] | null
          b2g1_live?: never
          bogo_enabled?: boolean | null
          bogo_ends_at?: string | null
          bogo_excluded_skus?: string[] | null
          bogo_live?: never
          id?: number | null
          server_now?: never
          updated_at?: string | null
        }
        Update: {
          b2g1_enabled?: boolean | null
          b2g1_ends_at?: string | null
          b2g1_excluded_skus?: string[] | null
          b2g1_live?: never
          bogo_enabled?: boolean | null
          bogo_ends_at?: string | null
          bogo_excluded_skus?: string[] | null
          bogo_live?: never
          id?: number | null
          server_now?: never
          updated_at?: string | null
        }
        Relationships: []
      }
      public_variant_overrides: {
        Row: {
          dose: string | null
          hidden: boolean | null
          inbound_units: number | null
          lead_days: number | null
          on_hand: number | null
          price_cents: number | null
          sku: string | null
        }
        Insert: {
          dose?: string | null
          hidden?: boolean | null
          inbound_units?: number | null
          lead_days?: number | null
          on_hand?: number | null
          price_cents?: number | null
          sku?: string | null
        }
        Update: {
          dose?: string | null
          hidden?: boolean | null
          inbound_units?: number | null
          lead_days?: number | null
          on_hand?: number | null
          price_cents?: number | null
          sku?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _apply_order_stock: {
        Args: {
          p_admin: string
          p_deduct: boolean
          p_notes: string
          p_order_id: string
          p_product_name: string
          p_quantity: number
          p_reason: Database["public"]["Enums"]["stock_movement_reason"]
          p_sku: string
        }
        Returns: undefined
      }
      _resolve_line_dose: {
        Args: { p_product_name: string; p_sku: string }
        Returns: string
      }
      adjust_stock: {
        Args: {
          p_delta: number
          p_notes?: string
          p_reason: Database["public"]["Enums"]["stock_movement_reason"]
          p_sku: string
        }
        Returns: number
      }
      admin_adjust_reward_points: {
        Args: { p_note: string; p_points: number; p_user_id: string }
        Returns: undefined
      }
      admin_apply_coupon: {
        Args: { p_code: string; p_order_id: string }
        Returns: Json
      }
      admin_audit_public_function_grants: {
        Args: never
        Returns: {
          arguments: string
          function_name: string
          grantee: string
        }[]
      }
      admin_audit_public_view_write_grants: {
        Args: never
        Returns: {
          grantee: string
          privilege_type: string
          view_name: string
        }[]
      }
      admin_campaign_recipients: {
        Args: { p_contact?: string; p_search?: string; p_segment?: string }
        Returns: Json
      }
      admin_clear_coupon: { Args: { p_order_id: string }; Returns: Json }
      admin_clear_coupons: { Args: { p_order_id: string }; Returns: Json }
      admin_convert_prepared_cart: {
        Args: {
          p_buyer_contact: string
          p_buyer_name: string
          p_buyer_organization?: string
          p_cart_id: string
          p_discount?: Json
          p_lines?: Json
          p_notes?: string
        }
        Returns: Json
      }
      admin_create_order: {
        Args: {
          p_buyer_contact: string
          p_buyer_name: string
          p_buyer_organization?: string
          p_discount?: Json
          p_lines?: Json
          p_notes?: string
          p_user_id?: string
        }
        Returns: Json
      }
      admin_create_prepared_cart: {
        Args: {
          p_coupon_code?: string
          p_lines: Json
          p_note?: string
          p_user_id: string
        }
        Returns: Json
      }
      admin_deactivate_customer_discount: {
        Args: { p_id: string }
        Returns: undefined
      }
      admin_email_log: {
        Args: { p_limit?: number; p_offset?: number }
        Returns: Json
      }
      admin_invitable_guests: { Args: { p_limit?: number }; Returns: Json }
      admin_log_member_invite: {
        Args: { p_channel?: string; p_email: string; p_points?: number }
        Returns: string
      }
      admin_member_activity: { Args: { p_customer_id: string }; Returns: Json }
      admin_member_attention: { Args: never; Returns: Json }
      admin_member_invites: {
        Args: { p_filter?: string; p_limit?: number; p_offset?: number }
        Returns: Json
      }
      admin_member_referrals: {
        Args: { p_limit?: number; p_offset?: number }
        Returns: Json
      }
      admin_member_roster: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_search?: string
          p_segment?: string
          p_sort?: string
        }
        Returns: Json
      }
      admin_member_spend_distribution: { Args: never; Returns: Json }
      admin_member_stats: { Args: never; Returns: Json }
      admin_member_vouchers: {
        Args: { p_limit?: number; p_offset?: number; p_status?: string }
        Returns: Json
      }
      admin_moderate_review: {
        Args: { p_id: string; p_status: string }
        Returns: Json
      }
      admin_prepared_carts: {
        Args: { p_limit?: number; p_user_id: string }
        Returns: Json
      }
      admin_redeem_reward_for: {
        Args: { p_note: string; p_user_id: string }
        Returns: Json
      }
      admin_remove_coupon: {
        Args: { p_code: string; p_order_id: string }
        Returns: Json
      }
      admin_review_queue: {
        Args: { p_limit?: number; p_offset?: number; p_status?: string }
        Returns: Json
      }
      admin_revoke_prepared_cart: { Args: { p_id: string }; Returns: Json }
      admin_set_automation_kind: {
        Args: { p_enabled: boolean; p_kind: string }
        Returns: Json
      }
      admin_set_customer_discount: {
        Args: {
          p_expires_at?: string
          p_label: string
          p_percent: number
          p_scope: string
          p_user_id: string
        }
        Returns: Json
      }
      admin_set_product_flag: {
        Args: { p_early_access: boolean; p_sku: string }
        Returns: Json
      }
      admin_set_profile_flags: {
        Args: {
          p_account_type: string
          p_business_name: string
          p_free_shipping?: boolean
          p_status: string
          p_tier: string
          p_user_id: string
        }
        Returns: undefined
      }
      admin_upsert_coupon: {
        Args: { p_id: string; p_payload: Json }
        Returns: Json
      }
      admin_void_voucher: {
        Args: {
          p_reason?: string
          p_refund_points?: boolean
          p_voucher_id: string
        }
        Returns: Json
      }
      automation_candidates: { Args: { p_kind: string }; Returns: Json }
      cancel_order: {
        Args: { p_order_id: string; p_reason: string }
        Returns: undefined
      }
      claim_order_with_account: { Args: { p_token: string }; Returns: Json }
      claim_prepared_cart: { Args: { p_token: string }; Returns: Json }
      clear_order_flag: { Args: { p_order_id: string }; Returns: undefined }
      confirm_order_fulfilled: {
        Args: {
          p_carrier?: string
          p_order_id: string
          p_tracking_number?: string
        }
        Returns: undefined
      }
      confirm_order_shipping: {
        Args: {
          p_city: string
          p_country: string
          p_state: string
          p_street: string
          p_token: string
          p_zip: string
        }
        Returns: Json
      }
      consume_reward_voucher: {
        Args: { p_order_id: string; p_voucher_id: string }
        Returns: Json
      }
      coupon_combinability_reason: {
        Args: {
          p_applied?: string[]
          p_candidate: string
          p_has_account?: boolean
          p_has_promo?: boolean
          p_has_reward?: boolean
        }
        Returns: string
      }
      create_order_from_inquiry: {
        Args: { p_inquiry_id: string }
        Returns: string
      }
      delete_order: {
        Args: { p_order_id: string; p_reason?: string }
        Returns: undefined
      }
      effective_customer_discount: {
        Args: { p_user_id: string }
        Returns: Json
      }
      gen_order_number: { Args: never; Returns: string }
      get_my_order: { Args: { p_order_number: string }; Returns: Json }
      get_my_referral_code: { Args: never; Returns: Json }
      get_my_reward_summary: { Args: never; Returns: Json }
      get_order_by_token: { Args: { p_token: string }; Returns: Json }
      import_inventory: { Args: { p_rows: Json }; Returns: Json }
      is_admin: { Args: never; Returns: boolean }
      link_my_orders: { Args: never; Returns: number }
      log_audit: {
        Args: {
          p_action: string
          p_after_value?: Json
          p_before_value?: Json
          p_context?: Json
          p_entity_id?: string
          p_entity_type: string
          p_summary?: string
        }
        Returns: string
      }
      lookup_order: {
        Args: { p_identifier: string; p_zip: string }
        Returns: {
          carrier: string
          delivered_at: string
          order_number: string
          placed_at: string
          shipped_at: string
          status: string
          tracking_number: string
        }[]
      }
      lookup_order_bump: {
        Args: { p_bucket: string; p_window: string }
        Returns: number
      }
      mark_order_delivered: { Args: { p_order_id: string }; Returns: undefined }
      mark_order_invoiced:
        | {
            Args: {
              p_invoice_amount_cents: number
              p_invoice_url: string
              p_order_id: string
              p_payment_method?: string
            }
            Returns: undefined
          }
        | {
            Args: {
              p_invoice_amount_cents: number
              p_invoice_url: string
              p_order_id: string
              p_payment_method?: string
              p_shipping_cents?: number
              p_subtotal_cents?: number
            }
            Returns: undefined
          }
      mark_order_paid: { Args: { p_order_id: string }; Returns: undefined }
      mark_payment_claimed: { Args: { p_order_id: string }; Returns: undefined }
      mark_product_deleted: { Args: { p_sku: string }; Returns: undefined }
      mark_receipt_sent: { Args: { p_order_id: string }; Returns: undefined }
      order_review_eligible: {
        Args: { p_order: Database["public"]["Tables"]["orders"]["Row"] }
        Returns: boolean
      }
      order_review_prompt: { Args: { p_token: string }; Returns: Json }
      prepared_cart_email_payload: {
        Args: { p_cart_id: string; p_token: string }
        Returns: Json
      }
      public_service_reviews: { Args: { p_limit?: number }; Returns: Json }
      recompute_order_totals: { Args: { p_order_id: string }; Returns: Json }
      reconcile_reward_vouchers: { Args: { p_repair?: boolean }; Returns: Json }
      record_member_invite: {
        Args: {
          p_channel?: string
          p_email: string
          p_points?: number
          p_sent_by?: string
        }
        Returns: string
      }
      redeem_coupon: {
        Args: {
          p_code: string
          p_contact: string
          p_discount_cents: number
          p_order_id: string
          p_order_net_cents: number
          p_user_id?: string
        }
        Returns: Json
      }
      redeem_reward: { Args: never; Returns: Json }
      referral_bonus_percent: { Args: never; Returns: number }
      referral_code_block_reason: {
        Args: { p_contact: string; p_coupon_id: string; p_user_id?: string }
        Returns: string
      }
      referral_window_days: { Args: never; Returns: number }
      restore_product: { Args: { p_sku: string }; Returns: undefined }
      revert_order_status: {
        Args: { p_order_id: string; p_reason: string }
        Returns: string
      }
      review_display_name: { Args: { p_name: string }; Returns: string }
      save_order_lines: {
        Args: { p_lines: Json; p_order_id: string }
        Returns: Json
      }
      seed_stock_row: {
        Args: { p_initial: number; p_sku: string }
        Returns: boolean
      }
      set_b2g1_promo: {
        Args: {
          p_enabled: boolean
          p_ends_at: string
          p_excluded_skus: string[]
        }
        Returns: {
          b2g1_enabled: boolean
          b2g1_ends_at: string | null
          b2g1_excluded_skus: string[]
          bogo_enabled: boolean
          bogo_ends_at: string | null
          bogo_excluded_skus: string[]
          id: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "promo_settings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_bogo_promo: {
        Args: {
          p_enabled: boolean
          p_ends_at: string
          p_excluded_skus: string[]
        }
        Returns: {
          b2g1_enabled: boolean
          b2g1_ends_at: string | null
          b2g1_excluded_skus: string[]
          bogo_enabled: boolean
          bogo_ends_at: string | null
          bogo_excluded_skus: string[]
          id: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "promo_settings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_customer_notes: {
        Args: { p_customer_id: string; p_notes: string }
        Returns: undefined
      }
      set_customer_status: {
        Args: { p_customer_id: string; p_status: string }
        Returns: undefined
      }
      set_order_shipping: {
        Args: { p_cents: number; p_order_id: string }
        Returns: Json
      }
      set_order_tracking: {
        Args: {
          p_carrier: string
          p_order_id: string
          p_tracking_number: string
        }
        Returns: undefined
      }
      set_product_hidden: {
        Args: { p_hidden: boolean; p_sku: string }
        Returns: undefined
      }
      set_product_price: {
        Args: { p_cents: number; p_sku: string }
        Returns: undefined
      }
      set_product_video: {
        Args: {
          p_description: string
          p_sku: string
          p_thumbnail: string
          p_title: string
          p_url: string
        }
        Returns: undefined
      }
      set_variant_hidden: {
        Args: { p_dose: string; p_hidden: boolean; p_sku: string }
        Returns: undefined
      }
      settle_referral_conversions: { Args: never; Returns: Json }
      squash_dose_text: { Args: { p_text: string }; Returns: string }
      submit_order_review: {
        Args: { p_comment?: string; p_rating: number; p_token: string }
        Returns: Json
      }
      validate_coupon: {
        Args: {
          p_applied_codes?: string[]
          p_code: string
          p_contact?: string
          p_has_account?: boolean
          p_has_promo?: boolean
          p_has_reward?: boolean
          p_subtotal_cents?: number
        }
        Returns: Json
      }
    }
    Enums: {
      order_status:
        | "pending_review"
        | "pending_invoice"
        | "quoted"
        | "invoice_sent"
        | "payment_claimed"
        | "paid"
        | "fulfilled"
        | "cancelled"
        | "refunded"
      stock_movement_reason:
        | "initial_seed"
        | "manual_adjustment"
        | "physical_count"
        | "restock_received"
        | "damage_loss"
        | "order_fulfilled"
        | "order_cancelled_after_fulfill"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      order_status: [
        "pending_review",
        "pending_invoice",
        "quoted",
        "invoice_sent",
        "payment_claimed",
        "paid",
        "fulfilled",
        "cancelled",
        "refunded",
      ],
      stock_movement_reason: [
        "initial_seed",
        "manual_adjustment",
        "physical_count",
        "restock_received",
        "damage_loss",
        "order_fulfilled",
        "order_cancelled_after_fulfill",
      ],
    },
  },
} as const

