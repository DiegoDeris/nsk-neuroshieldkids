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
      alerts: {
        Row: {
          child_id: string
          created_at: string
          id: string
          message: string
          parent_id: string
          read: boolean
          severity: string
          title: string
        }
        Insert: {
          child_id: string
          created_at?: string
          id?: string
          message: string
          parent_id: string
          read?: boolean
          severity: string
          title: string
        }
        Update: {
          child_id?: string
          created_at?: string
          id?: string
          message?: string
          parent_id?: string
          read?: boolean
          severity?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "alerts_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
        ]
      }
      children: {
        Row: {
          age: number
          avatar_emoji: string | null
          created_at: string
          id: string
          ingest_token: string | null
          last_ingest_at: string | null
          name: string
          parent_id: string
        }
        Insert: {
          age: number
          avatar_emoji?: string | null
          created_at?: string
          id?: string
          ingest_token?: string | null
          last_ingest_at?: string | null
          name: string
          parent_id: string
        }
        Update: {
          age?: number
          avatar_emoji?: string | null
          created_at?: string
          id?: string
          ingest_token?: string | null
          last_ingest_at?: string | null
          name?: string
          parent_id?: string
        }
        Relationships: []
      }
      emotional_scores: {
        Row: {
          actions: Json | null
          child_id: string
          created_at: string
          explanation: string | null
          id: string
          parent_id: string
          patterns: Json | null
          risk_level: string
          score: number
          source_metric_id: string | null
        }
        Insert: {
          actions?: Json | null
          child_id: string
          created_at?: string
          explanation?: string | null
          id?: string
          parent_id: string
          patterns?: Json | null
          risk_level: string
          score: number
          source_metric_id?: string | null
        }
        Update: {
          actions?: Json | null
          child_id?: string
          created_at?: string
          explanation?: string | null
          id?: string
          parent_id?: string
          patterns?: Json | null
          risk_level?: string
          score?: number
          source_metric_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "emotional_scores_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emotional_scores_source_metric_id_fkey"
            columns: ["source_metric_id"]
            isOneToOne: false
            referencedRelation: "usage_metrics"
            referencedColumns: ["id"]
          },
        ]
      }
      gamification: {
        Row: {
          badges: Json
          child_id: string
          id: string
          last_healthy_date: string | null
          level: number
          parent_id: string
          points: number
          streak_days: number
          updated_at: string
        }
        Insert: {
          badges?: Json
          child_id: string
          id?: string
          last_healthy_date?: string | null
          level?: number
          parent_id: string
          points?: number
          streak_days?: number
          updated_at?: string
        }
        Update: {
          badges?: Json
          child_id?: string
          id?: string
          last_healthy_date?: string | null
          level?: number
          parent_id?: string
          points?: number
          streak_days?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gamification_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: true
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
        ]
      }
      predictions: {
        Row: {
          child_id: string
          confidence: number
          created_at: string
          drivers: Json
          explanation: string | null
          horizon_days: number
          id: string
          parent_id: string
          predicted_risk: string
          predicted_score: number
          prevention_plan: Json
          trend: string
        }
        Insert: {
          child_id: string
          confidence?: number
          created_at?: string
          drivers?: Json
          explanation?: string | null
          horizon_days?: number
          id?: string
          parent_id: string
          predicted_risk: string
          predicted_score: number
          prevention_plan?: Json
          trend: string
        }
        Update: {
          child_id?: string
          confidence?: number
          created_at?: string
          drivers?: Json
          explanation?: string | null
          horizon_days?: number
          id?: string
          parent_id?: string
          predicted_risk?: string
          predicted_score?: number
          prevention_plan?: Json
          trend?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      quests: {
        Row: {
          category: string
          child_id: string
          completed_at: string | null
          created_at: string
          description: string | null
          due_date: string | null
          id: string
          parent_id: string
          points: number
          progress: number
          status: string
          target_days: number
          title: string
          updated_at: string
        }
        Insert: {
          category?: string
          child_id: string
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          parent_id: string
          points?: number
          progress?: number
          status?: string
          target_days?: number
          title: string
          updated_at?: string
        }
        Update: {
          category?: string
          child_id?: string
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          parent_id?: string
          points?: number
          progress?: number
          status?: string
          target_days?: number
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      recommendations: {
        Row: {
          body: string
          category: string | null
          child_id: string
          created_at: string
          done: boolean
          id: string
          parent_id: string
          title: string
        }
        Insert: {
          body: string
          category?: string | null
          child_id: string
          created_at?: string
          done?: boolean
          id?: string
          parent_id: string
          title: string
        }
        Update: {
          body?: string
          category?: string | null
          child_id?: string
          created_at?: string
          done?: boolean
          id?: string
          parent_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "recommendations_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
        ]
      }
      rules: {
        Row: {
          child_id: string | null
          config: Json
          cooldown_minutes: number
          created_at: string
          enabled: boolean
          id: string
          last_triggered_at: string | null
          name: string
          parent_id: string
          rule_type: string
          severity: string
          updated_at: string
        }
        Insert: {
          child_id?: string | null
          config?: Json
          cooldown_minutes?: number
          created_at?: string
          enabled?: boolean
          id?: string
          last_triggered_at?: string | null
          name: string
          parent_id: string
          rule_type: string
          severity?: string
          updated_at?: string
        }
        Update: {
          child_id?: string | null
          config?: Json
          cooldown_minutes?: number
          created_at?: string
          enabled?: boolean
          id?: string
          last_triggered_at?: string | null
          name?: string
          parent_id?: string
          rule_type?: string
          severity?: string
          updated_at?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          current_period_end: string | null
          free_analyses_used: number
          id: string
          plan: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          current_period_end?: string | null
          free_analyses_used?: number
          id?: string
          plan?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          current_period_end?: string | null
          free_analyses_used?: number
          id?: string
          plan?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      usage_events: {
        Row: {
          app_name: string | null
          child_id: string
          created_at: string
          duration_seconds: number
          event_type: string
          id: string
          metadata: Json
          occurred_at: string
          parent_id: string
          source: string
        }
        Insert: {
          app_name?: string | null
          child_id: string
          created_at?: string
          duration_seconds?: number
          event_type?: string
          id?: string
          metadata?: Json
          occurred_at?: string
          parent_id: string
          source?: string
        }
        Update: {
          app_name?: string | null
          child_id?: string
          created_at?: string
          duration_seconds?: number
          event_type?: string
          id?: string
          metadata?: Json
          occurred_at?: string
          parent_id?: string
          source?: string
        }
        Relationships: []
      }
      usage_metrics: {
        Row: {
          app_breakdown: Json | null
          child_id: string
          created_at: string
          dominant_app: string | null
          id: string
          metric_date: string
          night_minutes: number
          notes: string | null
          parent_id: string
          sessions: number
          source: string
          total_minutes: number
        }
        Insert: {
          app_breakdown?: Json | null
          child_id: string
          created_at?: string
          dominant_app?: string | null
          id?: string
          metric_date: string
          night_minutes?: number
          notes?: string | null
          parent_id: string
          sessions?: number
          source?: string
          total_minutes?: number
        }
        Update: {
          app_breakdown?: Json | null
          child_id?: string
          created_at?: string
          dominant_app?: string | null
          id?: string
          metric_date?: string
          night_minutes?: number
          notes?: string | null
          parent_id?: string
          sessions?: number
          source?: string
          total_minutes?: number
        }
        Relationships: [
          {
            foreignKeyName: "usage_metrics_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "children"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      aggregate_events_to_metric: {
        Args: { _child_id: string; _day: string }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
