import { useCallback, useState } from "react";
import { ArrowRight, Plus } from "@/icons/lucide-compat";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { useRouter } from "../../hooks/use-router";
import { RecentProjects } from "../welcome/RecentProjects";
import { StartFromScratch } from "../welcome/StartFromScratch";

export const ProjectListScreen: React.FC = () => {
  const { navigate } = useRouter();
  const [showCreateForm, setShowCreateForm] = useState(false);

  const handleProjectSelected = useCallback(() => {
    navigate("editor");
  }, [navigate]);

  const handleProjectCreated = useCallback(() => {
    navigate("editor");
  }, [navigate]);

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      <header className="flex items-center justify-between gap-4 px-6 py-4 border-b border-border">
        <div>
          <Text type="label" color="primary" weight="medium" className="text-sm text-text-primary">
            AI 剪辑项目
          </Text>
          <Text type="supporting" color="secondary" className="text-xs text-text-muted mt-1">
            OpenReel
          </Text>
        </div>
        <div className="flex items-center gap-2">
          <Button
            label="返回编辑器"
            variant="ghost"
            size="sm"
            icon={<ArrowRight className="rotate-180" size={16} aria-hidden />}
            onClick={() => navigate("editor")}
          />
          <Button
            label="新建项目"
            variant="primary"
            size="sm"
            icon={<Plus size={16} aria-hidden />}
            onClick={() => setShowCreateForm((open) => !open)}
          />
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto w-full max-w-5xl">
          {showCreateForm ? (
            <section className="rounded-xl border border-border bg-background-secondary p-6">
              <div className="mb-6 flex items-center justify-between gap-4">
                <Text type="body" color="primary" weight="semibold" className="text-lg text-text-primary">
                  新建项目
                </Text>
                <Button
                  label="取消"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowCreateForm(false)}
                />
              </div>
              <StartFromScratch onProjectCreated={handleProjectCreated} />
            </section>
          ) : (
            <section>
              <div className="mb-6 flex items-end justify-between gap-4">
                <div>
                  <Text type="body" color="primary" weight="semibold" className="text-2xl text-text-primary">
                    我的项目
                  </Text>
                  <Text type="supporting" color="secondary" className="text-sm text-text-muted mt-1">
                    选择一个项目继续编辑
                  </Text>
                </div>
                <Button
                  label="新建项目"
                  variant="secondary"
                  size="sm"
                  icon={<Plus size={16} aria-hidden />}
                  onClick={() => setShowCreateForm(true)}
                />
              </div>
              <RecentProjects onProjectSelected={handleProjectSelected} />
            </section>
          )}
        </div>
      </main>
    </div>
  );
};

export default ProjectListScreen;
