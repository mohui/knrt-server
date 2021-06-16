<template>
  <div style="height: 100%;">
    <el-card
      class="box-card"
      style="height: 100%;"
      shadow="never"
      :body-style="{
        height: 'calc(100% - 110px)',
        display: 'flex',
        'flex-direction': 'column',
        padding: $settings.isMobile ? '10px 0' : '20px'
      }"
    >
      <div slot="header" class="work-header">
        <span>工分项配置</span>
        <div>
          <el-button size="mini" type="primary" @click="addWorkVisible = true"
            >新增工分项</el-button
          >
        </div>
      </div>
      <kn-collapse
        :is-collapsed="isCollapsed"
        :is-show="$settings.isMobile"
        @toggle="is => (isCollapsed = is)"
      >
        <el-form
          ref="ruleForm"
          :model="searchForm"
          label-width="100px"
          size="mini"
        >
          <el-row>
            <el-col :lg="6" :md="6" :sm="12" :span="6" :xl="6" :xs="24">
              <el-form-item>
                <el-button
                  size="mini"
                  type="primary"
                  @click="$asyncComputed.serverData.update()"
                  >查询</el-button
                >
              </el-form-item>
            </el-col>
          </el-row>
        </el-form>
      </kn-collapse>
      <el-table
        v-loading="tableLoading"
        stripe
        size="small"
        :data="tableData"
        height="100%"
        style="flex-grow: 1;"
        :header-cell-style="{background: '#F3F4F7', color: '#555'}"
      >
        <el-table-column type="index" label="序号"></el-table-column>
        <el-table-column prop="work" align="center" label="工分项">
        </el-table-column>
        <el-table-column prop="scoreMethod" label="打分方式" align="center">
        </el-table-column>
        <el-table-column
          prop="project"
          label="关联项目"
          align="center"
          width="300"
        >
          <template slot-scope="{row}">
            <el-tooltip
              v-if="$widthCompute([row.projects.join(',')]) >= 300"
              effect="dark"
              placement="top"
              :content="row.projects.join(',')"
            >
              <div
                slot="content"
                v-html="toBreak(row.projects.join(','))"
              ></div>
              <span class="cell-long-span">{{ row.projects.join(',') }}</span>
            </el-tooltip>
            <div v-else>{{ row.projects.join(',') }}</div>
          </template>
        </el-table-column>
        <el-table-column prop="" label="操作" align="center">
          <template slot-scope="{row}">
            <el-tooltip content="编辑" :enterable="false">
              <el-button
                type="primary"
                icon="el-icon-edit"
                circle
                size="mini"
                @click="editRow(row)"
              >
              </el-button>
            </el-tooltip>
            <el-tooltip content="删除" :enterable="false">
              <el-button
                type="danger"
                :disabled="row.removeLoading"
                circle
                :icon="row.removeLoading ? 'el-icon-loading' : 'el-icon-delete'"
                size="mini"
                @click="removeRow(row)"
              >
              </el-button>
            </el-tooltip>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
    <el-dialog
      title="配置弹窗"
      :visible.sync="addWorkVisible"
      :width="$settings.isMobile ? '99%' : '50%'"
      :before-close="() => resetConfig('workForm')"
      :close-on-press-escape="false"
      :close-on-click-modal="false"
    >
      <el-form
        ref="workForm"
        :model="newWork"
        :rules="workRules"
        label-position="right"
        label-width="120px"
      >
        <el-form-item label="工分项" prop="work">
          <el-input v-model="newWork.work"> </el-input>
        </el-form-item>
        <el-form-item label="关联项目" prop="projectsSelected">
          <div class="long-tree">
            <el-tree
              ref="tree"
              :check-strictly="true"
              :data="workTreeData"
              :load="loadNode"
              :props="treeProps"
              lazy
              node-key="id"
              show-checkbox
              @check-change="treeCheck"
            ></el-tree>
          </div>
        </el-form-item>
        <el-form-item label="打分方式" prop="scoreMethod">
          <el-button-group>
            <el-button
              :class="{
                'el-button--primary': newWork.scoreMethod === HisWorkMethod.SUM
              }"
              size="small"
              @click="newWork.scoreMethod = HisWorkMethod.SUM"
            >
              {{ HisWorkMethod.SUM }}
            </el-button>
            <el-button
              :class="{
                'el-button--primary':
                  newWork.scoreMethod === HisWorkMethod.AMOUNT
              }"
              size="small"
              @click="newWork.scoreMethod = HisWorkMethod.AMOUNT"
            >
              {{ HisWorkMethod.AMOUNT }}
            </el-button>
          </el-button-group>
        </el-form-item>
        <el-form-item
          v-show="newWork.projectsSelected.length > 0"
          label="已有工分项"
        >
          <el-tag
            v-for="old in newWork.projectsSelected"
            :key="old.id"
            style="margin: 0 5px"
            >{{ old.name }}</el-tag
          >
        </el-form-item>
      </el-form>
      <div slot="footer" class="dialog-footer">
        <el-button @click="resetConfig('workForm')">取 消</el-button>
        <el-button v-loading="addBtnLoading" type="primary" @click="submit()">
          确 定
        </el-button>
      </div>
    </el-dialog>
  </div>
</template>

<script>
import {Permission} from '../../../../common/permission.ts';
import {HisWorkMethod, HisWorkSource} from '../../../../common/his.ts';

export default {
  name: 'Work',
  data() {
    const validaProjects = (rule, value, callback) => {
      if (value?.length < 1 && this.newWork.projectsSelected.length < 1) {
        callback(new Error('选择关联项目!'));
      }
      callback();
    };
    return {
      isCollapsed: !!this.$settings.isMobile,
      permission: Permission,
      searchForm: {
        work: '',
        scoreMethod: '',
        projects: [],
        dateRange: '',
        pageSize: 20,
        pageNo: 1
      },
      newWork: {
        work: '',
        source: HisWorkSource.CHECK,
        scoreMethod: HisWorkMethod.SUM,
        projects: [],
        projectsSelected: []
      },
      addWorkVisible: false,
      workRules: {
        work: [{required: true, message: '填写工分项', trigger: 'change'}],
        projectsSelected: [{validator: validaProjects, trigger: 'change'}]
      },
      tableLoading: false,
      addBtnLoading: false,
      searchLoading: false,
      HisWorkMethod: HisWorkMethod,
      HisWorkSource: Object.keys(HisWorkSource).map(it => ({
        value: HisWorkSource[it],
        key: it
      })),
      treeProps: {
        label: 'name',
        isLeaf: 'leaf'
      },
      currentTreeChecked: [] //当前被选中的node
    };
  },
  computed: {
    tableData() {
      return this.serverData.map(d => ({
        id: d.id,
        work: d.name,
        scoreMethod: d.method,
        projects: d.mappings.map(it => it.name),
        mappings: d.mappings,
        removeLoading: false
      }));
    }
  },
  watch: {},
  asyncComputed: {
    serverData: {
      async get() {
        this.tableLoading = true;
        const {work, scoreMethod, dateRange} = this.searchForm;
        console.log(work, scoreMethod, dateRange);
        try {
          return await this.$api.HisWorkItem.list();
        } catch (e) {
          console.error(e.message);
          this.$message.error(e.message);
          return [];
        } finally {
          this.tableLoading = false;
        }
      },
      default: []
    },
    workTreeData: {
      async get() {
        return await this.$api.HisWorkItem.sources(null, this.newWork.id);
      },
      default() {
        return [];
      }
    }
  },
  methods: {
    async submit() {
      try {
        const valid = await this.$refs['workForm'].validate();
        if (valid) {
          this.addBtnLoading = true;
          const paramsArr = [
            this.newWork.work,
            this.newWork.scoreMethod,
            this.newWork.projectsSelected.map(it => it.id) //被选中的项目id
          ];
          if (this.newWork.id) {
            paramsArr.splice(0, 0, this.newWork.id);
            await this.$api.HisWorkItem.update(...paramsArr);
          } else {
            await this.$api.HisWorkItem.add(...paramsArr);
          }
          this.$message.success('操作成功');
          this.$asyncComputed.serverData.update();
          this.resetConfig('workForm');
        }
      } catch (e) {
        console.error(e);
        if (e) this.$message.error(e.message);
      } finally {
        this.addBtnLoading = false;
      }
    },
    async editRow(row) {
      this.newWork = JSON.parse(
        JSON.stringify({
          id: row.id,
          work: row.work,
          scoreMethod: row.scoreMethod,
          projectsSelected: row.mappings.map(m => ({
            name: m.name,
            id: m.id
          })),
          projects: []
        })
      );
      this.workTreeData = await this.$api.HisWorkItem.sources(
        null,
        this.newWork?.id
      );
      this.currentTreeChecked = this.currentTreeChecked.concat(
        this.workTreeData.filter(it => it.selected).map(it => it.id)
      );
      this.addWorkVisible = true;
      this.$nextTick(() => {
        this.$refs.tree.setCheckedKeys(this.currentTreeChecked);
      });
    },
    async removeRow(row) {
      try {
        await this.$confirm('此操作将永久删除该工分项, 是否继续?', '提示', {
          confirmButtonText: '确定',
          cancelButtonText: '取消',
          type: 'warning'
        });
        row.removeLoading = true;
        await this.$api.HisWorkItem.delete(row.id);
        this.$message.success('删除成功');
        this.$asyncComputed.serverData.update();
      } catch (e) {
        e !== 'cancel' ? this.$message.error(e?.message) : '';
      } finally {
        row.removeLoading = false;
      }
    },
    resetConfig(ref) {
      this.$refs[ref].resetFields();
      this.$refs.tree.setCheckedKeys([]);
      //重置默认选中项
      this.currentTreeChecked = [];
      this.newWork = {
        work: '',
        source: HisWorkSource.CHECK,
        scoreMethod: HisWorkMethod.SUM,
        projects: [],
        projectsSelected: []
      };
      this.addWorkVisible = false;
    },
    toBreak(content) {
      let contentStr = '';
      for (let index in content) {
        if (index !== '0' && index % 20 === 0) contentStr += '<br/>';
        contentStr += content[index];
      }
      return contentStr;
    },
    async remoteSearch(query) {
      try {
        this.searchLoading = true;
        this.serverProjectData = await this.$api.HisWorkItem.searchSource(
          this.newWork.source,
          query || undefined
        );
      } catch (e) {
        console.error(e);
      } finally {
        this.searchLoading = false;
      }
    },
    async loadNode(node, resolve) {
      if (node.level === 0) {
        return resolve(this.workTreeData);
      }
      if (node.level > 0) {
        let data = await this.$api.HisWorkItem.sources(
          node.data.id,
          this.newWork?.id
        );
        this.currentTreeChecked = this.currentTreeChecked.concat(
          data.filter(it => it.selected).map(it => it.id)
        );
        this.$refs.tree.setCheckedKeys(this.currentTreeChecked);
        return resolve(data);
      }
    },
    treeCheck({id, name}, selected) {
      //选中的则push进当前选中项数组
      if (selected) {
        this.currentTreeChecked.push(id);
        //如果原有的工分项没有该项目,则添加进去
        if (this.newWork.projectsSelected.findIndex(old => old.id === id) < 0) {
          this.newWork.projectsSelected.push({id, name});
        }
      }
      //未选中的则从当前选中项剔除
      if (!selected) {
        this.currentTreeChecked.splice(
          this.currentTreeChecked.findIndex(it => it === id),
          1
        );
        //如果原有的工分项有该项目,则删除
        const index = this.newWork.projectsSelected.findIndex(
          old => old.id === id
        );
        if (index > -1) {
          this.newWork.projectsSelected.splice(index, 1);
        }
      }
    }
  }
};
</script>

<style scoped>
.work-header {
  display: flex;
  justify-content: space-between;
}
.long-tree {
  height: 40vh;
  overflow-y: auto;
  overflow-x: hidden;
}
.cell-long-span {
  width: 100%;
  display: block;
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
}
</style>