import type { Metadata } from "next";

import { CategoryForm, SchoolYearCategoryForm } from "@/components/admin/settings-forms";
import { PageHeader } from "@/components/portal/page-header";
import { requireTeacherAdmin } from "@/lib/dal/access";
import {
  listAllServiceCategories,
  listSchoolYearCategorySettings,
  listSchoolYears,
} from "@/lib/dal/portal";
import type { ServiceCategory } from "@/lib/types";

export const metadata: Metadata = { title: "Service categories" };

interface CategorySetting {
  category_id: string;
  is_available: boolean;
}

function param(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export default async function CategoriesSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireTeacherAdmin();
  const params = await searchParams;
  const years = await listSchoolYears();
  const yearId = param(params.year) || viewer.activeMembership.school_year_id;
  const [categoryData, settingData] = await Promise.all([
    listAllServiceCategories(),
    listSchoolYearCategorySettings(yearId),
  ]);
  const categories = (categoryData as unknown as ServiceCategory[]).toSorted((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
  const settings = settingData as unknown as CategorySetting[];

  return (
    <div className="page-container">
      <PageHeader
        title="Service categories"
        description="Name, describe, deactivate, and make categories available by school year without removing historical references."
      />

      <section aria-labelledby="master-categories-heading" className="rounded-xl border p-5 sm:p-6">
        <h2 id="master-categories-heading" className="text-xl font-bold">
          Category directory
        </h2>
        <p className="mb-6 mt-1 text-sm text-muted-foreground">
          Categories are listed alphabetically. Active names are unique without regard to letter
          case, and deactivation is archive-safe.
        </p>
        <div className="space-y-5 divide-y">
          {categories.map((category) => (
            <div key={category.id} className="pt-5 first:pt-0">
              <CategoryForm category={category} />
            </div>
          ))}
          <div className="pt-5">
            <CategoryForm />
          </div>
        </div>
      </section>

      <section
        aria-labelledby="year-categories-heading"
        className="mt-8 rounded-xl border p-5 sm:p-6"
      >
        <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="year-categories-heading" className="text-xl font-bold">
              School-year availability
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Choose which active categories members can use during the selected school year.
            </p>
          </div>
          <form>
            <label htmlFor="category-year" className="sr-only">
              School year
            </label>
            <select
              id="category-year"
              name="year"
              defaultValue={yearId}
              className="h-10 rounded-lg border bg-background px-3 text-sm"
            >
              {years.map((year) => (
                <option key={year.id} value={year.id}>
                  {year.label}
                </option>
              ))}
            </select>
            <button type="submit" className="ml-2 h-10 rounded-lg border px-3 text-sm font-medium">
              View
            </button>
          </form>
        </div>
        <div>
          {categories.map((category) => (
            <SchoolYearCategoryForm
              key={category.id}
              schoolYearId={yearId}
              category={category}
              setting={settings.find((setting) => setting.category_id === category.id)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
