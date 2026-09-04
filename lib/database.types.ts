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
      accounts: {
        Row: {
          account_icon: string | null
          account_name: string
          account_type: string
          color: string | null
          created_at: string
          id: string
          institution: string | null
          is_active: boolean
          opening_balance: number
          updated_at: string
          userid: string
        }
        Insert: {
          account_icon?: string | null
          account_name: string
          account_type: string
          color?: string | null
          created_at?: string
          id?: string
          institution?: string | null
          is_active?: boolean
          opening_balance?: number
          updated_at?: string
          userid: string
        }
        Update: {
          account_icon?: string | null
          account_name?: string
          account_type?: string
          color?: string | null
          created_at?: string
          id?: string
          institution?: string | null
          is_active?: boolean
          opening_balance?: number
          updated_at?: string
          userid?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounts_userid_fkey"
            columns: ["userid"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_userid_fkey"
            columns: ["userid"]
            isOneToOne: false
            referencedRelation: "v_dashboard_kpis"
            referencedColumns: ["userid"]
          },
        ]
      }
      budgets: {
        Row: {
          budget_amount: number
          budget_month: string
          categoryid: string
          created_at: string
          id: string
          userid: string
        }
        Insert: {
          budget_amount?: number
          budget_month: string
          categoryid: string
          created_at?: string
          id?: string
          userid: string
        }
        Update: {
          budget_amount?: number
          budget_month?: string
          categoryid?: string
          created_at?: string
          id?: string
          userid?: string
        }
        Relationships: [
          {
            foreignKeyName: "budgets_categoryid_fkey"
            columns: ["categoryid"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budgets_categoryid_fkey"
            columns: ["categoryid"]
            isOneToOne: false
            referencedRelation: "v_budget_vs_actual"
            referencedColumns: ["category_id"]
          },
          {
            foreignKeyName: "budgets_categoryid_fkey"
            columns: ["categoryid"]
            isOneToOne: false
            referencedRelation: "v_category_spending"
            referencedColumns: ["category_id"]
          },
          {
            foreignKeyName: "budgets_userid_fkey"
            columns: ["userid"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budgets_userid_fkey"
            columns: ["userid"]
            isOneToOne: false
            referencedRelation: "v_dashboard_kpis"
            referencedColumns: ["userid"]
          },
        ]
      }
      categories: {
        Row: {
          category_name: string
          category_type: string
          color: string | null
          created_at: string
          groupid: string
          icon: string | null
          id: string
          is_active: boolean
          userid: string
        }
        Insert: {
          category_name: string
          category_type?: string
          color?: string | null
          created_at?: string
          groupid: string
          icon?: string | null
          id?: string
          is_active?: boolean
          userid: string
        }
        Update: {
          category_name?: string
          category_type?: string
          color?: string | null
          created_at?: string
          groupid?: string
          icon?: string | null
          id?: string
          is_active?: boolean
          userid?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_groupid_fkey"
            columns: ["groupid"]
            isOneToOne: false
            referencedRelation: "category_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "categories_groupid_fkey"
            columns: ["groupid"]
            isOneToOne: false
            referencedRelation: "v_budget_vs_actual"
            referencedColumns: ["group_id"]
          },
          {
            foreignKeyName: "categories_groupid_fkey"
            columns: ["groupid"]
            isOneToOne: false
            referencedRelation: "v_category_spending"
            referencedColumns: ["group_id"]
          },
          {
            foreignKeyName: "categories_userid_fkey"
            columns: ["userid"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "categories_userid_fkey"
            columns: ["userid"]
            isOneToOne: false
            referencedRelation: "v_dashboard_kpis"
            referencedColumns: ["userid"]
          },
        ]
      }
      category_groups: {
        Row: {
          created_at: string
          id: string
          name: string
          sort_order: number
          userid: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          sort_order?: number
          userid: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          sort_order?: number
          userid?: string
        }
        Relationships: [
          {
            foreignKeyName: "category_groups_userid_fkey"
            columns: ["userid"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "category_groups_userid_fkey"
            columns: ["userid"]
            isOneToOne: false
            referencedRelation: "v_dashboard_kpis"
            referencedColumns: ["userid"]
          },
        ]
      }
      goal_contributions: {
        Row: {
          amount: number
          created_at: string
          date: string
          funding_method: string
          goalid: string
          id: string
          transactionid: string | null
        }
        Insert: {
          amount?: number
          created_at?: string
          date: string
          funding_method?: string
          goalid: string
          id?: string
          transactionid?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          date?: string
          funding_method?: string
          goalid?: string
          id?: string
          transactionid?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "goal_contributions_goalid_fkey"
            columns: ["goalid"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_contributions_goalid_fkey"
            columns: ["goalid"]
            isOneToOne: false
            referencedRelation: "v_goal_progress"
            referencedColumns: ["goal_id"]
          },
          {
            foreignKeyName: "goal_contributions_transactionid_fkey"
            columns: ["transactionid"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      goals: {
        Row: {
          accountid: string | null
          created_at: string
          goal_name: string
          goal_type: string
          id: string
          monthly_contribution: number | null
          status: string
          target_amount: number
          target_date: string | null
          tracking_method: string
          updated_at: string
          userid: string
        }
        Insert: {
          accountid?: string | null
          created_at?: string
          goal_name: string
          goal_type: string
          id?: string
          monthly_contribution?: number | null
          status?: string
          target_amount: number
          target_date?: string | null
          tracking_method?: string
          updated_at?: string
          userid: string
        }
        Update: {
          accountid?: string | null
          created_at?: string
          goal_name?: string
          goal_type?: string
          id?: string
          monthly_contribution?: number | null
          status?: string
          target_amount?: number
          target_date?: string | null
          tracking_method?: string
          updated_at?: string
          userid?: string
        }
        Relationships: [
          {
            foreignKeyName: "goals_accountid_fkey"
            columns: ["accountid"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goals_accountid_fkey"
            columns: ["accountid"]
            isOneToOne: false
            referencedRelation: "v_account_balances"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "goals_userid_fkey"
            columns: ["userid"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goals_userid_fkey"
            columns: ["userid"]
            isOneToOne: false
            referencedRelation: "v_dashboard_kpis"
            referencedColumns: ["userid"]
          },
        ]
      }
      investments: {
        Row: {
          accountid: string
          asset_type: string
          average_cost: number
          created_at: string
          current_price: number | null
          id: string
          shares: number
          ticker: string
          userid: string
        }
        Insert: {
          accountid: string
          asset_type?: string
          average_cost?: number
          created_at?: string
          current_price?: number | null
          id?: string
          shares?: number
          ticker: string
          userid: string
        }
        Update: {
          accountid?: string
          asset_type?: string
          average_cost?: number
          created_at?: string
          current_price?: number | null
          id?: string
          shares?: number
          ticker?: string
          userid?: string
        }
        Relationships: [
          {
            foreignKeyName: "investments_accountid_fkey"
            columns: ["accountid"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "investments_accountid_fkey"
            columns: ["accountid"]
            isOneToOne: false
            referencedRelation: "v_account_balances"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "investments_userid_fkey"
            columns: ["userid"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "investments_userid_fkey"
            columns: ["userid"]
            isOneToOne: false
            referencedRelation: "v_dashboard_kpis"
            referencedColumns: ["userid"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          is_read: boolean
          message: string
          notification_type: string
          title: string
          userid: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          message: string
          notification_type: string
          title: string
          userid: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          message?: string
          notification_type?: string
          title?: string
          userid?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_userid_fkey"
            columns: ["userid"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_userid_fkey"
            columns: ["userid"]
            isOneToOne: false
            referencedRelation: "v_dashboard_kpis"
            referencedColumns: ["userid"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          first_name: string
          id: string
          last_name: string
          lastlogin: string | null
          phone: string | null
          subscription_plan: string | null
          subscription_status: string | null
          updated_at: string
          username: string | null
        }
        Insert: {
          created_at?: string
          first_name: string
          id: string
          last_name: string
          lastlogin?: string | null
          phone?: string | null
          subscription_plan?: string | null
          subscription_status?: string | null
          updated_at?: string
          username?: string | null
        }
        Update: {
          created_at?: string
          first_name?: string
          id?: string
          last_name?: string
          lastlogin?: string | null
          phone?: string | null
          subscription_plan?: string | null
          subscription_status?: string | null
          updated_at?: string
          username?: string | null
        }
        Relationships: []
      }
      recurring_transactions: {
        Row: {
          accountid: string
          amount: number
          categoryid: string
          created_at: string
          description: string
          end_date: string | null
          frequency: string
          id: string
          is_active: boolean
          next_run_date: string
          start_date: string | null
          userid: string
        }
        Insert: {
          accountid: string
          amount: number
          categoryid: string
          created_at?: string
          description: string
          end_date?: string | null
          frequency?: string
          id?: string
          is_active?: boolean
          next_run_date: string
          start_date?: string | null
          userid: string
        }
        Update: {
          accountid?: string
          amount?: number
          categoryid?: string
          created_at?: string
          description?: string
          end_date?: string | null
          frequency?: string
          id?: string
          is_active?: boolean
          next_run_date?: string
          start_date?: string | null
          userid?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_transactions_accountid_fkey"
            columns: ["accountid"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_transactions_accountid_fkey"
            columns: ["accountid"]
            isOneToOne: false
            referencedRelation: "v_account_balances"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "recurring_transactions_categoryid_fkey"
            columns: ["categoryid"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_transactions_categoryid_fkey"
            columns: ["categoryid"]
            isOneToOne: false
            referencedRelation: "v_budget_vs_actual"
            referencedColumns: ["category_id"]
          },
          {
            foreignKeyName: "recurring_transactions_categoryid_fkey"
            columns: ["categoryid"]
            isOneToOne: false
            referencedRelation: "v_category_spending"
            referencedColumns: ["category_id"]
          },
          {
            foreignKeyName: "recurring_transactions_userid_fkey"
            columns: ["userid"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_transactions_userid_fkey"
            columns: ["userid"]
            isOneToOne: false
            referencedRelation: "v_dashboard_kpis"
            referencedColumns: ["userid"]
          },
        ]
      }
      settings: {
        Row: {
          created_at: string
          currency: string
          date_format: string
          default_budget_month: number | null
          id: string
          notifications_enabled: boolean
          theme: string
          updated_at: string
          userid: string
          week_start: number
        }
        Insert: {
          created_at?: string
          currency?: string
          date_format?: string
          default_budget_month?: number | null
          id?: string
          notifications_enabled?: boolean
          theme?: string
          updated_at?: string
          userid: string
          week_start?: number
        }
        Update: {
          created_at?: string
          currency?: string
          date_format?: string
          default_budget_month?: number | null
          id?: string
          notifications_enabled?: boolean
          theme?: string
          updated_at?: string
          userid?: string
          week_start?: number
        }
        Relationships: [
          {
            foreignKeyName: "settings_userid_fkey"
            columns: ["userid"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settings_userid_fkey"
            columns: ["userid"]
            isOneToOne: false
            referencedRelation: "v_dashboard_kpis"
            referencedColumns: ["userid"]
          },
        ]
      }
      subscriptions: {
        Row: {
          created_at: string
          id: string
          plan: string
          renewal_date: string
          status: string
          stripe_customer_id: string
          stripe_subscription_id: string
          userid: string
        }
        Insert: {
          created_at?: string
          id?: string
          plan?: string
          renewal_date: string
          status?: string
          stripe_customer_id: string
          stripe_subscription_id: string
          userid: string
        }
        Update: {
          created_at?: string
          id?: string
          plan?: string
          renewal_date?: string
          status?: string
          stripe_customer_id?: string
          stripe_subscription_id?: string
          userid?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_userid_fkey"
            columns: ["userid"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_userid_fkey"
            columns: ["userid"]
            isOneToOne: false
            referencedRelation: "v_dashboard_kpis"
            referencedColumns: ["userid"]
          },
        ]
      }
      transactions: {
        Row: {
          accountid: string
          amount: number
          categoryid: string | null
          created_at: string
          description: string
          goalid: string | null
          id: string
          idempotency_key: string | null
          merchant: string | null
          notes: string | null
          payment_method: string | null
          recurringid: string | null
          transaction_date: string
          transaction_type: string
          transfer_group_id: string | null
          updated_at: string
          userid: string
        }
        Insert: {
          accountid: string
          amount?: number
          categoryid?: string | null
          created_at?: string
          description: string
          goalid?: string | null
          id?: string
          idempotency_key?: string | null
          merchant?: string | null
          notes?: string | null
          payment_method?: string | null
          recurringid?: string | null
          transaction_date?: string
          transaction_type?: string
          transfer_group_id?: string | null
          updated_at?: string
          userid: string
        }
        Update: {
          accountid?: string
          amount?: number
          categoryid?: string | null
          created_at?: string
          description?: string
          goalid?: string | null
          id?: string
          idempotency_key?: string | null
          merchant?: string | null
          notes?: string | null
          payment_method?: string | null
          recurringid?: string | null
          transaction_date?: string
          transaction_type?: string
          transfer_group_id?: string | null
          updated_at?: string
          userid?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_accountid_fkey"
            columns: ["accountid"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_accountid_fkey"
            columns: ["accountid"]
            isOneToOne: false
            referencedRelation: "v_account_balances"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "transactions_categoryid_fkey"
            columns: ["categoryid"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_categoryid_fkey"
            columns: ["categoryid"]
            isOneToOne: false
            referencedRelation: "v_budget_vs_actual"
            referencedColumns: ["category_id"]
          },
          {
            foreignKeyName: "transactions_categoryid_fkey"
            columns: ["categoryid"]
            isOneToOne: false
            referencedRelation: "v_category_spending"
            referencedColumns: ["category_id"]
          },
          {
            foreignKeyName: "transactions_goalid_fkey"
            columns: ["goalid"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_goalid_fkey"
            columns: ["goalid"]
            isOneToOne: false
            referencedRelation: "v_goal_progress"
            referencedColumns: ["goal_id"]
          },
          {
            foreignKeyName: "transactions_recurringid_fkey"
            columns: ["recurringid"]
            isOneToOne: false
            referencedRelation: "recurring_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_recurringid_fkey"
            columns: ["recurringid"]
            isOneToOne: false
            referencedRelation: "v_upcoming_recurring"
            referencedColumns: ["recurring_id"]
          },
          {
            foreignKeyName: "transactions_userid_fkey"
            columns: ["userid"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_userid_fkey"
            columns: ["userid"]
            isOneToOne: false
            referencedRelation: "v_dashboard_kpis"
            referencedColumns: ["userid"]
          },
        ]
      }
    }
    Views: {
      v_account_balances: {
        Row: {
          account_icon: string | null
          account_id: string | null
          account_name: string | null
          account_type: string | null
          balance: number | null
          color: string | null
          first_transaction_date: string | null
          institution: string | null
          is_active: boolean | null
          last_transaction_date: string | null
          opening_balance: number | null
          transaction_count: number | null
          userid: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accounts_userid_fkey"
            columns: ["userid"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_userid_fkey"
            columns: ["userid"]
            isOneToOne: false
            referencedRelation: "v_dashboard_kpis"
            referencedColumns: ["userid"]
          },
        ]
      }
      v_budget_vs_actual: {
        Row: {
          actual_spend: number | null
          budget_amount: number | null
          budget_id: string | null
          budget_month: string | null
          category_color: string | null
          category_icon: string | null
          category_id: string | null
          category_name: string | null
          group_id: string | null
          group_name: string | null
          is_over_budget: boolean | null
          pct_used: number | null
          remaining: number | null
          status: string | null
          status_rank: number | null
          transaction_count: number | null
          userid: string | null
        }
        Relationships: [
          {
            foreignKeyName: "budgets_userid_fkey"
            columns: ["userid"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budgets_userid_fkey"
            columns: ["userid"]
            isOneToOne: false
            referencedRelation: "v_dashboard_kpis"
            referencedColumns: ["userid"]
          },
        ]
      }
      v_category_spending: {
        Row: {
          avg_transaction: number | null
          category_color: string | null
          category_icon: string | null
          category_id: string | null
          category_name: string | null
          group_id: string | null
          group_name: string | null
          group_sort_order: number | null
          largest_transaction: number | null
          month: string | null
          pct_of_month: number | null
          total_spend: number | null
          transaction_count: number | null
          userid: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_userid_fkey"
            columns: ["userid"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_userid_fkey"
            columns: ["userid"]
            isOneToOne: false
            referencedRelation: "v_dashboard_kpis"
            referencedColumns: ["userid"]
          },
        ]
      }
      v_daily_cashflow: {
        Row: {
          day: string | null
          expenses: number | null
          income: number | null
          net_cashflow: number | null
          running_net: number | null
          transaction_count: number | null
          userid: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_userid_fkey"
            columns: ["userid"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_userid_fkey"
            columns: ["userid"]
            isOneToOne: false
            referencedRelation: "v_dashboard_kpis"
            referencedColumns: ["userid"]
          },
        ]
      }
      v_dashboard_kpis: {
        Row: {
          cash_balance: number | null
          investment_balance: number | null
          net_cashflow: number | null
          net_worth: number | null
          period_month: string | null
          savings_rate_pct: number | null
          total_assets: number | null
          total_earned: number | null
          total_liabilities: number | null
          total_spent: number | null
          transaction_count: number | null
          userid: string | null
        }
        Relationships: []
      }
      v_goal_progress: {
        Row: {
          accountid: string | null
          contributed_amount: number | null
          contribution_count: number | null
          goal_id: string | null
          goal_name: string | null
          goal_type: string | null
          is_on_track: boolean | null
          last_contribution_date: string | null
          monthly_contribution: number | null
          pct_complete: number | null
          projected_completion_date: string | null
          remaining_amount: number | null
          status: string | null
          target_amount: number | null
          target_date: string | null
          tracking_method: string | null
          userid: string | null
        }
        Relationships: [
          {
            foreignKeyName: "goals_accountid_fkey"
            columns: ["accountid"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goals_accountid_fkey"
            columns: ["accountid"]
            isOneToOne: false
            referencedRelation: "v_account_balances"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "goals_userid_fkey"
            columns: ["userid"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goals_userid_fkey"
            columns: ["userid"]
            isOneToOne: false
            referencedRelation: "v_dashboard_kpis"
            referencedColumns: ["userid"]
          },
        ]
      }
      v_goals_summary: {
        Row: {
          active_goals: number | null
          completed_goals: number | null
          contributed_this_month: number | null
          goals_off_track: number | null
          goals_on_track: number | null
          overall_pct_complete: number | null
          planned_monthly_contribution: number | null
          total_goals: number | null
          total_remaining: number | null
          total_saved: number | null
          total_target: number | null
          userid: string | null
        }
        Relationships: [
          {
            foreignKeyName: "goals_userid_fkey"
            columns: ["userid"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goals_userid_fkey"
            columns: ["userid"]
            isOneToOne: false
            referencedRelation: "v_dashboard_kpis"
            referencedColumns: ["userid"]
          },
        ]
      }
      v_integrity_issues: {
        Row: {
          detail: string | null
          issue_type: string | null
          record_id: string | null
          severity: string | null
          table_name: string | null
          userid: string | null
        }
        Relationships: []
      }
      v_investment_holdings: {
        Row: {
          account_name: string | null
          accountid: string | null
          asset_type: string | null
          average_cost: number | null
          cost_basis: number | null
          current_price: number | null
          investment_id: string | null
          is_open: boolean | null
          market_value: number | null
          price_is_stale: boolean | null
          shares: number | null
          ticker: string | null
          unrealized_gain_loss: number | null
          unrealized_pct: number | null
          userid: string | null
        }
        Relationships: [
          {
            foreignKeyName: "investments_accountid_fkey"
            columns: ["accountid"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "investments_accountid_fkey"
            columns: ["accountid"]
            isOneToOne: false
            referencedRelation: "v_account_balances"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "investments_userid_fkey"
            columns: ["userid"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "investments_userid_fkey"
            columns: ["userid"]
            isOneToOne: false
            referencedRelation: "v_dashboard_kpis"
            referencedColumns: ["userid"]
          },
        ]
      }
      v_monthly_cashflow: {
        Row: {
          expense_count: number | null
          expenses: number | null
          income: number | null
          income_count: number | null
          month: string | null
          net_cashflow: number | null
          savings_rate_pct: number | null
          userid: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_userid_fkey"
            columns: ["userid"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_userid_fkey"
            columns: ["userid"]
            isOneToOne: false
            referencedRelation: "v_dashboard_kpis"
            referencedColumns: ["userid"]
          },
        ]
      }
      v_net_worth: {
        Row: {
          account_count: number | null
          net_worth: number | null
          total_assets: number | null
          total_liabilities: number | null
          userid: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accounts_userid_fkey"
            columns: ["userid"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_userid_fkey"
            columns: ["userid"]
            isOneToOne: false
            referencedRelation: "v_dashboard_kpis"
            referencedColumns: ["userid"]
          },
        ]
      }
      v_portfolio_summary: {
        Row: {
          account_name: string | null
          accountid: string | null
          holding_count: number | null
          pct_of_portfolio: number | null
          stale_price_count: number | null
          total_cost_basis: number | null
          total_market_value: number | null
          total_return_pct: number | null
          total_unrealized_gain_loss: number | null
          userid: string | null
        }
        Relationships: [
          {
            foreignKeyName: "investments_accountid_fkey"
            columns: ["accountid"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "investments_accountid_fkey"
            columns: ["accountid"]
            isOneToOne: false
            referencedRelation: "v_account_balances"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "investments_userid_fkey"
            columns: ["userid"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "investments_userid_fkey"
            columns: ["userid"]
            isOneToOne: false
            referencedRelation: "v_dashboard_kpis"
            referencedColumns: ["userid"]
          },
        ]
      }
      v_upcoming_recurring: {
        Row: {
          account_color: string | null
          account_name: string | null
          accountid: string | null
          amount: number | null
          category_color: string | null
          category_icon: string | null
          category_name: string | null
          categoryid: string | null
          days_until: number | null
          description: string | null
          end_date: string | null
          frequency: string | null
          is_overdue: boolean | null
          next_run_date: string | null
          recurring_id: string | null
          start_date: string | null
          userid: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recurring_transactions_accountid_fkey"
            columns: ["accountid"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_transactions_accountid_fkey"
            columns: ["accountid"]
            isOneToOne: false
            referencedRelation: "v_account_balances"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "recurring_transactions_categoryid_fkey"
            columns: ["categoryid"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_transactions_categoryid_fkey"
            columns: ["categoryid"]
            isOneToOne: false
            referencedRelation: "v_budget_vs_actual"
            referencedColumns: ["category_id"]
          },
          {
            foreignKeyName: "recurring_transactions_categoryid_fkey"
            columns: ["categoryid"]
            isOneToOne: false
            referencedRelation: "v_category_spending"
            referencedColumns: ["category_id"]
          },
          {
            foreignKeyName: "recurring_transactions_userid_fkey"
            columns: ["userid"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_transactions_userid_fkey"
            columns: ["userid"]
            isOneToOne: false
            referencedRelation: "v_dashboard_kpis"
            referencedColumns: ["userid"]
          },
        ]
      }
    }
    Functions: {
      category_spend_between: {
        Args: { p_from: string; p_to: string }
        Returns: {
          category_id: string
          category_name: string
          group_id: string
          group_name: string
          group_sort_order: number
          total_spend: number
        }[]
      }
      delete_own_account: { Args: never; Returns: undefined }
      email_for_username: { Args: { p_username: string }; Returns: string }
      record_login: {
        Args: never
        Returns: {
          first_name: string
          previous_login_at: string
        }[]
      }
      seed_default_categories: {
        Args: { p_userid: string }
        Returns: undefined
      }
      signed_amount: {
        Args: { p_amount: number; p_type: string }
        Returns: number
      }
      username_is_available: { Args: { p_username: string }; Returns: boolean }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
