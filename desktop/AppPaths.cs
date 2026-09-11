using System;
using System.IO;

namespace SankeyMoney;

/// <summary>
/// 单文件发布时 <see cref="AppContext.BaseDirectory"/> 指向临时解包目录，
/// 而数据与日志必须放在 exe 真正所在的目录，才能保持“便携”语义。
/// </summary>
internal static class AppPaths
{
    /// <summary>exe 实际所在目录（非单文件与单文件发布都正确）。</summary>
    public static string ExeDir =>
        Path.GetDirectoryName(Environment.ProcessPath) ?? AppContext.BaseDirectory;

    /// <summary>只读资源（wwwroot / Assets）所在目录；单文件发布时是解包目录。</summary>
    public static string AssetsDir => AppContext.BaseDirectory;
}
