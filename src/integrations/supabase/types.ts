export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      activities: {
        Row: {
          assigned_to: string | null
          completed: boolean
          completed_at: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          deal_id: string | null
          description: string | null
          due_at: string | null
          id: string
          title: string
          type: Database["public"]["Enums"]["activity_type"]
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          deal_id?: string | null
          description?: string | null
          due_at?: string | null
          id?: string
          title: string
          type?: Database["public"]["Enums"]["activity_type"]
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          deal_id?: string | null
          description?: string | null
          due_at?: string | null
          id?: string
          title?: string
          type?: Database["public"]["Enums"]["activity_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "activities_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          budget: number | null
          cities: string[] | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          deal_id: string | null
          end_date: string
          id: string
          impressions_target: number | null
          name: string
          notes: string | null
          owner_id: string | null
          renewal_reminder_sent: boolean
          report_due_date: string | null
          report_sent_at: string | null
          screens: string[] | null
          start_date: string
          status: Database["public"]["Enums"]["campaign_status"]
          updated_at: string
        }
        Insert: {
          budget?: number | null
          cities?: string[] | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          deal_id?: string | null
          end_date: string
          id?: string
          impressions_target?: number | null
          name: string
          notes?: string | null
          owner_id?: string | null
          renewal_reminder_sent?: boolean
          report_due_date?: string | null
          report_sent_at?: string | null
          screens?: string[] | null
          start_date: string
          status?: Database["public"]["Enums"]["campaign_status"]
          updated_at?: string
        }
        Update: {
          budget?: number | null
          cities?: string[] | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          deal_id?: string | null
          end_date?: string
          id?: string
          impressions_target?: number | null
          name?: string
          notes?: string | null
          owner_id?: string | null
          renewal_reminder_sent?: boolean
          report_due_date?: string | null
          report_sent_at?: string | null
          screens?: string[] | null
          start_date?: string
          status?: Database["public"]["Enums"]["campaign_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
        ]
      }
      company_settings: {
        Row: {
          created_at: string
          id: boolean
          monthly_budget: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: boolean
          monthly_budget?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: boolean
          monthly_budget?: number
          updated_at?: string
        }
        Relationships: []
      }
      customers: {
        Row: {
          billing_address: string | null
          city: string | null
          company_name: string
          contact_name: string | null
          created_at: string
          created_by: string | null
          email: string | null
          id: string
          industry: string | null
          invoice_email: string | null
          invoice_peppol_id: string | null
          invoice_reference: string | null
          notes: string | null
          org_number: string | null
          owner_id: string | null
          phone: string | null
          postal_code: string | null
          updated_at: string
          vat_number: string | null
        }
        Insert: {
          billing_address?: string | null
          city?: string | null
          company_name: string
          contact_name?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          industry?: string | null
          invoice_email?: string | null
          invoice_peppol_id?: string | null
          invoice_reference?: string | null
          notes?: string | null
          org_number?: string | null
          owner_id?: string | null
          phone?: string | null
          postal_code?: string | null
          updated_at?: string
          vat_number?: string | null
        }
        Update: {
          billing_address?: string | null
          city?: string | null
          company_name?: string
          contact_name?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          industry?: string | null
          invoice_email?: string | null
          invoice_peppol_id?: string | null
          invoice_reference?: string | null
          notes?: string | null
          org_number?: string | null
          owner_id?: string | null
          phone?: string | null
          postal_code?: string | null
          updated_at?: string
          vat_number?: string | null
        }
        Relationships: []
      }
      deals: {
        Row: {
          campaign_end: string | null
          campaign_start: string | null
          campaign_weeks: number | null
          commission_pct_override: number | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          expected_close_date: string | null
          id: string
          impressions: number | null
          notes: string | null
          owner_id: string | null
          package_id: string | null
          probability: number | null
          product_id: string | null
          source: string | null
          sov_pct: number | null
          stage: Database["public"]["Enums"]["deal_stage"]
          title: string
          updated_at: string
          value: number | null
          won_at: string | null
        }
        Insert: {
          campaign_end?: string | null
          campaign_start?: string | null
          campaign_weeks?: number | null
          commission_pct_override?: number | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          expected_close_date?: string | null
          id?: string
          impressions?: number | null
          notes?: string | null
          owner_id?: string | null
          package_id?: string | null
          probability?: number | null
          product_id?: string | null
          source?: string | null
          sov_pct?: number | null
          stage?: Database["public"]["Enums"]["deal_stage"]
          title: string
          updated_at?: string
          value?: number | null
          won_at?: string | null
        }
        Update: {
          campaign_end?: string | null
          campaign_start?: string | null
          campaign_weeks?: number | null
          commission_pct_override?: number | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          expected_close_date?: string | null
          id?: string
          impressions?: number | null
          notes?: string | null
          owner_id?: string | null
          package_id?: string | null
          probability?: number | null
          product_id?: string | null
          source?: string | null
          sov_pct?: number | null
          stage?: Database["public"]["Enums"]["deal_stage"]
          title?: string
          updated_at?: string
          value?: number | null
          won_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deals_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "product_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          comment: string | null
          company_name: string | null
          contact_name: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          email: string | null
          followup_date: string | null
          id: string
          owner_id: string | null
          phone: string | null
          status: Database["public"]["Enums"]["lead_status"]
          updated_at: string
        }
        Insert: {
          comment?: string | null
          company_name?: string | null
          contact_name?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          email?: string | null
          followup_date?: string | null
          id?: string
          owner_id?: string | null
          phone?: string | null
          status?: Database["public"]["Enums"]["lead_status"]
          updated_at?: string
        }
        Update: {
          comment?: string | null
          company_name?: string | null
          contact_name?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          email?: string | null
          followup_date?: string | null
          id?: string
          owner_id?: string | null
          phone?: string | null
          status?: Database["public"]["Enums"]["lead_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      materials: {
        Row: {
          assigned_to: string | null
          campaign_id: string
          created_at: string
          created_by: string | null
          deadline: string | null
          dimensions: string | null
          duration_seconds: number | null
          file_url: string | null
          format: string | null
          id: string
          notes: string | null
          status: Database["public"]["Enums"]["material_status"]
          title: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          campaign_id: string
          created_at?: string
          created_by?: string | null
          deadline?: string | null
          dimensions?: string | null
          duration_seconds?: number | null
          file_url?: string | null
          format?: string | null
          id?: string
          notes?: string | null
          status?: Database["public"]["Enums"]["material_status"]
          title: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          campaign_id?: string
          created_at?: string
          created_by?: string | null
          deadline?: string | null
          dimensions?: string | null
          duration_seconds?: number | null
          file_url?: string | null
          format?: string | null
          id?: string
          notes?: string | null
          status?: Database["public"]["Enums"]["material_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "materials_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          commission_amount: number
          commission_pct: number
          created_at: string
          id: string
          impressions: number | null
          order_id: string
          period_unit: Database["public"]["Enums"]["period_unit"]
          position: number
          product_id: string | null
          product_name: string
          sov_pct: number | null
          unit_price: number
          weeks: number
        }
        Insert: {
          commission_amount?: number
          commission_pct?: number
          created_at?: string
          id?: string
          impressions?: number | null
          order_id: string
          period_unit?: Database["public"]["Enums"]["period_unit"]
          position?: number
          product_id?: string | null
          product_name: string
          sov_pct?: number | null
          unit_price?: number
          weeks?: number
        }
        Update: {
          commission_amount?: number
          commission_pct?: number
          created_at?: string
          id?: string
          impressions?: number | null
          order_id?: string
          period_unit?: Database["public"]["Enums"]["period_unit"]
          position?: number
          product_id?: string | null
          product_name?: string
          sov_pct?: number | null
          unit_price?: number
          weeks?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      order_materials: {
        Row: {
          created_at: string
          customer_id: string | null
          file_name: string
          file_path: string
          id: string
          mime_type: string | null
          notes: string | null
          order_id: string
          size_bytes: number | null
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          customer_id?: string | null
          file_name: string
          file_path: string
          id?: string
          mime_type?: string | null
          notes?: string | null
          order_id: string
          size_bytes?: number | null
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          customer_id?: string | null
          file_name?: string
          file_path?: string
          id?: string
          mime_type?: string | null
          notes?: string | null
          order_id?: string
          size_bytes?: number | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_materials_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_materials_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_splits: {
        Row: {
          created_at: string
          id: string
          order_id: string
          share_pct: number
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          order_id: string
          share_pct: number
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          order_id?: string
          share_pct?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_splits_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          billing_address: string | null
          billing_duration_months: number
          billing_frequency: Database["public"]["Enums"]["billing_frequency"]
          city: string | null
          company_name: string
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          deal_id: string | null
          exact_dates: string[]
          id: string
          invoice_email: string | null
          invoice_info: string | null
          invoice_peppol_id: string | null
          invoice_reference: string | null
          invoice_start_date: string | null
          invoice_status: string | null
          invoiced_at: string | null
          marked_ready_at: string | null
          notes: string | null
          order_type: Database["public"]["Enums"]["order_type"]
          org_number: string | null
          owner_id: string | null
          postal_code: string | null
          selected_weeks: number[]
          status: string
          total_commission: number
          total_excl_vat: number
          updated_at: string
          vat_number: string | null
        }
        Insert: {
          billing_address?: string | null
          billing_duration_months?: number
          billing_frequency?: Database["public"]["Enums"]["billing_frequency"]
          city?: string | null
          company_name: string
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          deal_id?: string | null
          exact_dates?: string[]
          id?: string
          invoice_email?: string | null
          invoice_info?: string | null
          invoice_peppol_id?: string | null
          invoice_reference?: string | null
          invoice_start_date?: string | null
          invoice_status?: string | null
          invoiced_at?: string | null
          marked_ready_at?: string | null
          notes?: string | null
          order_type?: Database["public"]["Enums"]["order_type"]
          org_number?: string | null
          owner_id?: string | null
          postal_code?: string | null
          selected_weeks?: number[]
          status?: string
          total_commission?: number
          total_excl_vat?: number
          updated_at?: string
          vat_number?: string | null
        }
        Update: {
          billing_address?: string | null
          billing_duration_months?: number
          billing_frequency?: Database["public"]["Enums"]["billing_frequency"]
          city?: string | null
          company_name?: string
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          deal_id?: string | null
          exact_dates?: string[]
          id?: string
          invoice_email?: string | null
          invoice_info?: string | null
          invoice_peppol_id?: string | null
          invoice_reference?: string | null
          invoice_start_date?: string | null
          invoice_status?: string | null
          invoiced_at?: string | null
          marked_ready_at?: string | null
          notes?: string | null
          order_type?: Database["public"]["Enums"]["order_type"]
          org_number?: string | null
          owner_id?: string | null
          postal_code?: string | null
          selected_weeks?: number[]
          status?: string
          total_commission?: number
          total_excl_vat?: number
          updated_at?: string
          vat_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
        ]
      }
      package_products: {
        Row: {
          created_at: string
          id: string
          package_id: string
          position: number
          product_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          package_id: string
          position?: number
          product_id: string
        }
        Update: {
          created_at?: string
          id?: string
          package_id?: string
          position?: number
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "package_products_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "product_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "package_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_packages: {
        Row: {
          active: boolean
          created_at: string
          description: string | null
          id: string
          impressions: number | null
          name: string
          price: number
          product_id: string | null
          sov: number | null
          sov_pct: number | null
          updated_at: string
          views: number | null
          weeks: number | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          description?: string | null
          id?: string
          impressions?: number | null
          name: string
          price?: number
          product_id?: string | null
          sov?: number | null
          sov_pct?: number | null
          updated_at?: string
          views?: number | null
          weeks?: number | null
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string | null
          id?: string
          impressions?: number | null
          name?: string
          price?: number
          product_id?: string | null
          sov?: number | null
          sov_pct?: number | null
          updated_at?: string
          views?: number | null
          weeks?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "product_packages_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          active: boolean
          ad_duration_seconds: number | null
          address: string | null
          city: string | null
          commission_pct_provision_only: number | null
          commission_pct_with_base: number | null
          contacts_per_week: number | null
          created_at: string
          default_commission_pct: number
          description: string | null
          dimensions: string | null
          file_format: string | null
          format: string | null
          id: string
          image_url: string | null
          latitude: number | null
          longitude: number | null
          material_spec: string | null
          name: string
          screen_type: Database["public"]["Enums"]["screen_type"]
          updated_at: string
        }
        Insert: {
          active?: boolean
          ad_duration_seconds?: number | null
          address?: string | null
          city?: string | null
          commission_pct_provision_only?: number | null
          commission_pct_with_base?: number | null
          contacts_per_week?: number | null
          created_at?: string
          default_commission_pct?: number
          description?: string | null
          dimensions?: string | null
          file_format?: string | null
          format?: string | null
          id?: string
          image_url?: string | null
          latitude?: number | null
          longitude?: number | null
          material_spec?: string | null
          name: string
          screen_type?: Database["public"]["Enums"]["screen_type"]
          updated_at?: string
        }
        Update: {
          active?: boolean
          ad_duration_seconds?: number | null
          address?: string | null
          city?: string | null
          commission_pct_provision_only?: number | null
          commission_pct_with_base?: number | null
          contacts_per_week?: number | null
          created_at?: string
          default_commission_pct?: number
          description?: string | null
          dimensions?: string | null
          file_format?: string | null
          format?: string | null
          id?: string
          image_url?: string | null
          latitude?: number | null
          longitude?: number | null
          material_spec?: string | null
          name?: string
          screen_type?: Database["public"]["Enums"]["screen_type"]
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          phone: string | null
          title: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          phone?: string | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          phone?: string | null
          title?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      seller_compensation: {
        Row: {
          base_salary: number
          compensation_type: Database["public"]["Enums"]["compensation_type"]
          created_at: string
          default_commission_pct: number
          half_year_budget: number
          monthly_budget: number
          quarterly_budget: number
          updated_at: string
          user_id: string
          yearly_budget: number
        }
        Insert: {
          base_salary?: number
          compensation_type?: Database["public"]["Enums"]["compensation_type"]
          created_at?: string
          default_commission_pct?: number
          half_year_budget?: number
          monthly_budget?: number
          quarterly_budget?: number
          updated_at?: string
          user_id: string
          yearly_budget?: number
        }
        Update: {
          base_salary?: number
          compensation_type?: Database["public"]["Enums"]["compensation_type"]
          created_at?: string
          default_commission_pct?: number
          half_year_budget?: number
          monthly_budget?: number
          quarterly_budget?: number
          updated_at?: string
          user_id?: string
          yearly_budget?: number
        }
        Relationships: []
      }
      seller_credentials: {
        Row: {
          created_at: string
          initial_password: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          initial_password: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          initial_password?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      seller_monthly_budgets: {
        Row: {
          amount: number
          created_at: string
          month: number
          updated_at: string
          user_id: string
          year: number
        }
        Insert: {
          amount?: number
          created_at?: string
          month: number
          updated_at?: string
          user_id: string
          year: number
        }
        Update: {
          amount?: number
          created_at?: string
          month?: number
          updated_at?: string
          user_id?: string
          year?: number
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_manage_order: { Args: { _order_id: string }; Returns: boolean }
      get_order_commission: {
        Args: { _order_id: string }
        Returns: {
          item_commission_amount: number
          item_commission_pct: number
          item_id: string
          order_id: string
          total_commission: number
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      my_order_commissions: {
        Args: never
        Returns: {
          order_id: string
          total_commission: number
        }[]
      }
    }
    Enums: {
      activity_type: "samtal" | "mote" | "mejl" | "uppgift" | "paminnelse"
      app_role: "admin" | "saljare" | "produktion"
      billing_frequency: "engang" | "manad" | "kvartal" | "halvar"
      campaign_status:
        | "planerad"
        | "material_produktion"
        | "redo_for_live"
        | "live"
        | "avslutad"
        | "rapport_skickad"
      compensation_type: "endast_provision" | "med_grundlon"
      deal_stage:
        | "ny"
        | "kontaktad"
        | "offert"
        | "forhandling"
        | "vunnen"
        | "forlorad"
      lead_status:
        | "tackat_nej"
        | "kallt_mail"
        | "ej_svar"
        | "pratat_telefon"
        | "offert"
        | "nara_avslut"
      material_status:
        | "ej_inkommet"
        | "under_produktion"
        | "kundgranskning"
        | "godkant"
        | "levererat"
      order_type: "offert" | "bokning"
      period_unit: "veckor" | "manader" | "ar"
      screen_type: "egen" | "extern" | "digital"
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
  public: {
    Enums: {
      activity_type: ["samtal", "mote", "mejl", "uppgift", "paminnelse"],
      app_role: ["admin", "saljare", "produktion"],
      billing_frequency: ["engang", "manad", "kvartal", "halvar"],
      campaign_status: [
        "planerad",
        "material_produktion",
        "redo_for_live",
        "live",
        "avslutad",
        "rapport_skickad",
      ],
      compensation_type: ["endast_provision", "med_grundlon"],
      deal_stage: [
        "ny",
        "kontaktad",
        "offert",
        "forhandling",
        "vunnen",
        "forlorad",
      ],
      lead_status: [
        "tackat_nej",
        "kallt_mail",
        "ej_svar",
        "pratat_telefon",
        "offert",
        "nara_avslut",
      ],
      material_status: [
        "ej_inkommet",
        "under_produktion",
        "kundgranskning",
        "godkant",
        "levererat",
      ],
      order_type: ["offert", "bokning"],
      period_unit: ["veckor", "manader", "ar"],
      screen_type: ["egen", "extern", "digital"],
    },
  },
} as const
