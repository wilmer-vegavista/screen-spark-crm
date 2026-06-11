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
          sov_pct: number | null
          updated_at: string
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
          sov_pct?: number | null
          updated_at?: string
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
          sov_pct?: number | null
          updated_at?: string
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
          address: string | null
          commission_pct_provision_only: number | null
          commission_pct_with_base: number | null
          contacts_per_week: number | null
          created_at: string
          default_commission_pct: number
          description: string | null
          dimensions: string | null
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
          address?: string | null
          commission_pct_provision_only?: number | null
          commission_pct_with_base?: number | null
          contacts_per_week?: number | null
          created_at?: string
          default_commission_pct?: number
          description?: string | null
          dimensions?: string | null
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
          address?: string | null
          commission_pct_provision_only?: number | null
          commission_pct_with_base?: number | null
          contacts_per_week?: number | null
          created_at?: string
          default_commission_pct?: number
          description?: string | null
          dimensions?: string | null
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
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
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
          updated_at: string
          user_id: string
        }
        Insert: {
          base_salary?: number
          compensation_type?: Database["public"]["Enums"]["compensation_type"]
          created_at?: string
          default_commission_pct?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          base_salary?: number
          compensation_type?: Database["public"]["Enums"]["compensation_type"]
          created_at?: string
          default_commission_pct?: number
          updated_at?: string
          user_id?: string
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
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      activity_type: "samtal" | "mote" | "mejl" | "uppgift" | "paminnelse"
      app_role: "admin" | "saljare" | "produktion"
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
      material_status:
        | "ej_inkommet"
        | "under_produktion"
        | "kundgranskning"
        | "godkant"
        | "levererat"
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
      material_status: [
        "ej_inkommet",
        "under_produktion",
        "kundgranskning",
        "godkant",
        "levererat",
      ],
      screen_type: ["egen", "extern", "digital"],
    },
  },
} as const
